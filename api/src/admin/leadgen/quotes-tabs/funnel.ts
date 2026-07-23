// LeadGen admin UI — Quotes editor, FUNNEL BUILDER tab module (LEADGEN-REWORK-03
// §12 P3a mechanical split of ui-quotes.ts). Owns: the §4.1 frame-studio
// canvas + structure panel (pages/slots/A-B/ruled-slot rendering) + the
// right-hand per-region inspector column (which embeds the routing-rules
// panel — Round-4 P4b relocated the standalone Rules tab in here) + the
// variant chrome, and the ENTIRE strict-ES5 client island script
// (QUOTE_EDITOR_SCRIPT) that drives every tab's interactivity (one island per
// page, per the admin layout.ts convention — it cannot be split across files
// without breaking the template-literal, so it moves here byte-for-byte:
// L-185/the phase dispatch's "moving islands means moving the WHOLE template
// literal intact"). P3b (board + rules UI rebuild, §8.2) owns this file next.
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).

import { escapeHtml } from "../../templates/layout";
import { LEADGEN_ELIGIBILITY_REASON_LABELS } from "../ui-offers";
import {
  FRAME_BACKGROUND_STYLES,
  FRAME_BACK_POSITIONS,
  FRAME_BACK_STYLES,
  FRAME_DISCLOSURE_LOCATIONS,
  FRAME_FOOTER_SHOW_ON,
  FRAME_LOGO_ALIGNS,
  FRAME_PROGRESS_ALIGNS,
  FRAME_PROGRESS_POSITIONS,
  FRAME_PROGRESS_STYLES,
  FRAME_PROGRESS_WIDTHS,
  FRAME_SIZES,
  FRAME_SLOT_CARDS,
  FRAME_SLOT_OFFSETS,
  FRAME_SLOT_TRANSITIONS,
  FRAME_TRUST_MOBILE_MODES,
  FRAME_TRUST_PLACEMENTS,
} from "../../../public/leadgen/designs/frames";
import { FUNNEL_TOKEN_ROLES } from "../../../public/leadgen/designs/theme";
import {
  // P3b S3b.1 follow-up: the funnel-tab RIGHT rail is S3b.2's (§8.2 RIGHT,
  // MOUNT CONTRACT documented at renderQuoteRulesRail's own doc comment). The
  // board renders it at the pack's 344px right-rail mount point; the composer
  // (ui-quotes.ts) assembles QuoteRulesRailData and threads it here + adds
  // QUOTE_RULES_SCRIPT to the page's scripts bundle. `RoutingBuilderData` is
  // the now-unused-here wire type renderBuilderPanel's signature still
  // carries (kept — the composer's call site is unchanged shape).
  renderQuoteRulesRail,
  type QuoteRulesRailData,
  type RoutingBuilderData,
} from "../ui-rules-builder";
import {
  type RuleNode,
  type VariantNode,
  type SectionRef,
  type AbEntryNode,
  type RuledCaseNode,
  type PageSlotNode,
  type PageNode,
  type StructureBody,
  type FunnelNode,
  type BoardPage,
  type SharedPageBody,
  type AvailableSection,
  type AuctionListItem,
  type FrameTemplateItem,
  type PreviewSiteOption,
  type RulesBuilderData,
  PREFLIGHT_BLOCK_CODE_LABELS,
  PROBLEM_SCOPE_ORDER,
  PROBLEM_SCOPE_LABELS,
  PREFLIGHT_PASS_CHECKS,
  FRAME_REGION_LABELS,
  OVERRIDE_GROUP_LABELS,
  primaryVariantOf,
  renderRoleStrip,
  frameControl,
  frameCheck,
  frameSelect,
  frameInput,
  mediaPickerControl,
  renderOverrideSwitch,
  scopeHead,
  renderFrameList,
  renderSiteSelect,
  renderTemplatePicker,
} from "./shared";


// ============================================================================
// P3b (§8.2) — Funnel-builder BOARD. Replaces the removed canvas / variant /
// structure / region-inspector / old-rules chrome (§10): the operator sees a
// library-left / board-center / rules-right builder. Left = a draggable
// section library (292px). Center = a pinned "Shared first page" column then
// one column per funnel by display_order, h-scroll INSIDE the board only.
// Right = a clean 344px mount the routing-rules rail (S3b.2,
// ui-rules-builder.renderRoutingRulesPanel) fills — this slice builds NO rules
// UI. Geometry/classes/strings pinned to docs/leadgen/rework/design-pack/
// board.html; Appendix A strings (A-1/A-2/A-3) are rendered verbatim; A-4/A-5
// are emitted by the server and rendered by the island as returned.
// ----------------------------------------------------------------------------

// DEV-59 mapping-dot tri-state (kept — EXPORTED, re-exported by ui-quotes.ts;
// the board's section-chip dot reuses it).
export function mappingDotStatus(raw: string | undefined | null): "complete" | "incomplete" | "none" {
  if (raw === "complete") return "complete";
  if (raw === "incomplete" || raw === "invalid") return "incomplete";
  return "none";
}

export const MAPPING_DOT_TITLES: Readonly<Record<"complete" | "incomplete" | "none", string>> = {
  complete: "Offer mapping complete",
  incomplete: "Offer mapping incomplete",
  none: "No Offers selected yet",
};


// --- inline icons (studio-vocabulary SVG, ~0 engine bytes; admin-only) -------
const BOARD_ICON = {
  grip: `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="3" cy="3" r="1.4"/><circle cx="9" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="9" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="9" cy="13" r="1.4"/></svg>`,
  kebab: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>`,
  plus: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  x: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  search: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.2-3.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  star: `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l2 5 5 .4-3.8 3.3 1.2 5L12 18l-4.6 2.7 1.2-5L4.8 7.4l5-.4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  arrow: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};


// Section usage across the quote: public_id -> the set of funnel public_ids
// (funnel plans) that reference it, + whether the shared page uses it. Drives
// the library "in use" badge (§8.2 LEFT).
function computeSectionUsage(structure: StructureBody): Map<string, Set<string>> {
  const usage = new Map<string, Set<string>>();
  const add = (pub: string, funnelKey: string): void => {
    const set = usage.get(pub) ?? new Set<string>();
    set.add(funnelKey);
    usage.set(pub, set);
  };
  for (const s of structure.shared_page?.sections ?? []) add(s.section_public_id, "__shared__");
  for (const f of structure.funnels) {
    for (const page of f.active_variant_pages ?? []) {
      for (const slot of page.slots) {
        for (const cand of slot.candidates) add(cand.section_id, f.public_id);
      }
    }
  }
  return usage;
}


function renderLibraryCard(
  section: AvailableSection,
  usage: Map<string, Set<string>>,
  currentFunnelPublicId: string,
): string {
  const funnelsUsing = usage.get(section.public_id) ?? new Set<string>();
  const inCurrent = funnelsUsing.has(currentFunnelPublicId);
  const funnelCount = Array.from(funnelsUsing).filter((k) => k !== "__shared__").length;
  let badge = "";
  if (inCurrent) {
    badge = `<span class="lg-chip-inuse-here" data-pin="8.2-library-inuse-badge">In this funnel</span>`;
  } else if (funnelCount > 0) {
    badge = `<span class="lg-chip-inuse">In ${funnelCount} funnel${funnelCount === 1 ? "" : "s"}</span>`;
  }
  const activityVert = `${section.activity} · ${section.vertical}`;
  return `<div class="lg-lib-card${inCurrent ? " in-current" : ""}" data-lib-card data-section-public-id="${escapeHtml(section.public_id)}" data-section-name="${escapeHtml(section.section_name)}" data-vertical-key="${escapeHtml(section.vertical.toLowerCase())}" data-activity-key="${escapeHtml(section.activity.toLowerCase())}" data-pin="8.2-library-card" role="button" tabindex="0" aria-label="Add section ${escapeHtml(section.section_name)} to a page">
    <div class="lg-lc-top"><span class="lg-grip" aria-hidden="true">${BOARD_ICON.grip}</span><span class="lg-lc-name">${escapeHtml(section.section_name)}</span></div>
    <div class="lg-lc-meta"><span class="lg-chip-activity">${escapeHtml(activityVert)}</span>${badge}</div>
  </div>`;
}


function renderBoardLibrary(available: AvailableSection[], structure: StructureBody, currentFunnelPublicId: string): string {
  const usage = computeSectionUsage(structure);
  const verticals: string[] = [];
  const seen = new Set<string>();
  for (const s of available) {
    const key = s.vertical.toLowerCase();
    if (key !== "" && !seen.has(key)) { seen.add(key); verticals.push(s.vertical); }
  }
  const filters = [`<button type="button" class="lg-filter-pill active" data-lib-filter="">All</button>`]
    .concat(verticals.map((v) => `<button type="button" class="lg-filter-pill" data-lib-filter="${escapeHtml(v.toLowerCase())}">${escapeHtml(v)}</button>`))
    .join("");
  const cards = available.map((s) => renderLibraryCard(s, usage, currentFunnelPublicId)).join("");
  return `<div class="lg-board-left" data-pin="8.2-left-library">
    <div class="lg-lib-head">
      <div class="lg-lib-title">Section library</div>
      <div class="lg-lib-search" data-pin="8.2-library-search"><span class="lg-lib-search-ico" aria-hidden="true">${BOARD_ICON.search}</span><input type="search" data-lib-search placeholder="Search sections" aria-label="Search sections" /></div>
      <div class="lg-lib-filters" data-lib-filters>${filters}</div>
    </div>
    <div class="lg-lib-list" data-lib-list>
      ${cards || `<p class="lg-col-help" style="padding:8px 4px">No sections for this activity yet.</p>`}
    </div>
  </div>`;
}


// One section chip inside a page card. `variant` distinguishes the shared-page
// chip (kebab menu {A/B this slot, Slot rule, Remove}) from a funnel-page chip
// (kebab menu {Move up, Move down, Remove} — the a11y menu-equivalent of the
// move drag, §8.2). data-slot-id/data-slot-kind ride when known (funnel chips).
function renderSectionChip(
  name: string,
  sectionPublicId: string,
  opts: { scope: "shared" | "funnel"; slotId?: number; slotKind?: string; mappingStatus?: string },
): string {
  const menuName = opts.scope === "shared" ? "shared-chip" : "funnel-chip";
  const slotAttrs = opts.slotId !== undefined ? ` data-slot-id="${opts.slotId}" data-slot-kind="${escapeHtml(opts.slotKind ?? "fixed")}"` : "";
  const dot = mappingDotStatus(opts.mappingStatus);
  return `<div class="lg-sec-chip" data-sec-chip data-chip-scope="${opts.scope}" data-section-public-id="${escapeHtml(sectionPublicId)}"${slotAttrs}${opts.scope === "shared" ? ' data-pin="8.2-shared-chip"' : ""}>
    <span class="lg-grip lg-chip-grip" data-chip-grip aria-hidden="true">${BOARD_ICON.grip}</span>
    <span class="lg-map-dot" data-mapping-status="${dot}" title="${escapeHtml(MAPPING_DOT_TITLES[dot])}"></span>
    <span class="lg-sc-name">${escapeHtml(name)}</span>
    <span class="lg-kebab-btn lg-chip-kebab" data-chip-kebab data-chip-menu="${menuName}" role="button" tabindex="0" aria-label="Section options">${BOARD_ICON.kebab}</span>
  </div>`;
}


function renderSharedColumn(sharedPage: SharedPageBody | null | undefined): string {
  const sections = sharedPage?.sections ?? [];
  const chips = sections
    .map((s) => renderSectionChip(s.section_name, s.section_public_id, { scope: "shared", mappingStatus: s.mapping_status }))
    .join("");
  return `<div class="lg-col lg-col-shared" data-shared-col data-page-public-id="${escapeHtml(sharedPage?.page_id ?? "")}" data-pin="8.2-shared-first-page">
    <div class="lg-col-head">
      <span class="lg-col-tag">${BOARD_ICON.star} Shared · quote-owned</span>
      <div class="lg-col-title-row"><span class="lg-col-title">Shared first page</span></div>
      <div class="lg-col-meta"><span class="lg-col-help">Every visitor sees this first — entry rules only pre-select the funnel (§4.3-2).</span></div>
    </div>
    <div class="lg-col-body" data-shared-body>
      <div class="lg-page-card" data-shared-page-card>
        <div class="lg-page-head"><span class="lg-page-num">Page 1</span></div>
        <div class="lg-chip-list" data-chip-list>${chips}</div>
        <span class="lg-add-section" data-add-shared-section role="button" tabindex="0">${BOARD_ICON.plus} ＋ section</span>
      </div>
      <div class="lg-hint-neutral">Only one shared page — its sections can be A/B'd per slot.</div>
    </div>
  </div>`;
}


function renderBoardPageCard(page: BoardPage, index: number): string {
  const chips = page.slots
    .map((slot) => {
      const primary = slot.candidates[0];
      const name = slot.kind === "ab"
        ? `A/B: ${slot.candidates.map((c) => c.section_name).join(" / ") || "empty"}`
        : slot.kind === "ruled"
          ? `Rule: ${primary?.section_name ?? "empty"}`
          : (primary?.section_name ?? "empty");
      return renderSectionChip(name, primary?.section_id ?? "", { scope: "funnel", slotId: slot.slot_id, slotKind: slot.kind, mappingStatus: primary?.mapping_status });
    })
    .join("");
  return `<div class="lg-page-card" data-page-card data-page-public-id="${escapeHtml(page.page_id)}" data-page-index="${index}" data-pin="8.2-page-card">
    <div class="lg-page-head">
      <span class="lg-grip lg-page-grip" data-page-grip aria-hidden="true">${BOARD_ICON.grip}</span>
      <span class="lg-page-num">Page ${index + 1}</span>
      <span class="lg-kebab-btn lg-page-kebab" data-page-kebab data-chip-menu="page" role="button" tabindex="0" aria-label="Page options">${BOARD_ICON.kebab}</span>
    </div>
    <div class="lg-chip-list" data-chip-list>${chips}</div>
    <span class="lg-add-section" data-add-section role="button" tabindex="0">${BOARD_ICON.plus} ＋ section</span>
  </div>`;
}


function renderDefaultChip(): string {
  // Appendix A-3 (verbatim): chip label "Default" + tooltip copy.
  return `<span class="lg-badge-default" data-default-chip data-pin="4.3-default-chip" tabindex="0" aria-label="Default funnel">Default<span class="lg-tip" role="tooltip" data-pin="A-3-tooltip">Visitors who match no rule see this funnel.</span></span>`;
}


function templateLabelFor(funnel: FunnelNode, templates: FrameTemplateItem[]): string {
  // M5: the funnel's base template. FrameTemplateItem ids are the built-in
  // arrangement ids; a saved-record numeric id is best-effort resolved by the
  // island against the fuller record list — here the SSR shows the label if a
  // built-in matches, else a neutral "Template" the picker refines.
  const idStr = funnel.frame_template_id === null || funnel.frame_template_id === undefined ? "" : String(funnel.frame_template_id);
  const match = templates.find((t) => t.id === idStr);
  return match ? match.label : "Template";
}


function renderFunnelColumn(
  funnel: FunnelNode,
  structure: StructureBody,
  templates: FrameTemplateItem[],
): string {
  const isDefault = structure.quote.default_funnel_id !== null && structure.quote.default_funnel_id !== undefined && funnel.id === structure.quote.default_funnel_id;
  const pages = funnel.active_variant_pages ?? [];
  const runningArms = funnel.variants.filter((v) => v.traffic_allocation_bp > 0).length;
  const activeArms = funnel.variants.length;
  const abLabel = activeArms > 1 ? `A/B · ${activeArms} arms` : "A/B";
  void runningArms;
  const templateName = templateLabelFor(funnel, templates);

  const body = pages.length > 0
    ? pages.map((p, i) => renderBoardPageCard(p, i)).join("") +
      `<div class="lg-add-page" data-add-page role="button" tabindex="0">${BOARD_ICON.plus} + Add page</div>`
    // Appendix A-1 (verbatim): empty funnel column.
    : `<div class="lg-empty-col-body"><div class="lg-empty-hint" data-pin="A-1-empty-funnel">No pages yet — drag a section here or click + Add page.</div><div class="lg-add-page" data-add-page role="button" tabindex="0">${BOARD_ICON.plus} + Add page</div></div>`;

  return `<div class="lg-col lg-col-funnel${isDefault ? " is-default" : ""}" data-funnel-col data-funnel-public-id="${escapeHtml(funnel.public_id)}" data-funnel-id="${funnel.id}" data-funnel-active-variant="${escapeHtml(funnel.active_variant_public_id ?? "")}" data-pin="8.2-funnel-column">
    <div class="lg-col-head" data-pin="8.2-funnel-header">
      <div class="lg-col-title-row">
        <span class="lg-col-title" data-funnel-name data-pin="8.2-inline-rename" tabindex="0" role="textbox" aria-label="Funnel name (click to rename)">${escapeHtml(funnel.funnel_name)}</span>
        ${isDefault ? renderDefaultChip() : ""}
        <span class="lg-kebab-btn lg-funnel-kebab" data-funnel-kebab data-chip-menu="funnel" role="button" tabindex="0" aria-label="Funnel options">${BOARD_ICON.kebab}</span>
      </div>
      <div class="lg-col-meta">
        <span class="lg-pickchip" data-theme-picker data-pin="8.2-theme-picker" role="button" tabindex="0">Theme</span>
        <span class="lg-pickchip" data-template-picker data-pin="8.2-template-picker" role="button" tabindex="0">${escapeHtml(templateName)}</span>
      </div>
      <div class="lg-col-actions">
        <span class="lg-badge-ab" data-ab-badge data-pin="4.3-ab-badge" role="button" tabindex="0">${escapeHtml(abLabel)}</span>
        <span class="lg-btn-ghost lg-col-preview" data-preview data-pin="8.2-preview" role="button" tabindex="0">Preview${BOARD_ICON.arrow}</span>
      </div>
    </div>
    <div class="lg-col-body" data-funnel-body>${body}</div>
  </div>`;
}


function renderAddFunnelStub(): string {
  // Appendix A-2 (verbatim): "+ Add funnel" / sub.
  return `<div class="lg-stub-col" data-add-funnel data-pin="8.2-add-funnel-stub" role="button" tabindex="0" aria-label="Add funnel">
    <span class="lg-plus-ring">${BOARD_ICON.plus}</span>
    <span class="lg-stub-title">+ Add funnel</span>
    <span class="lg-stub-sub">Visitors reach it through routing rules.</span>
  </div>`;
}


// Menu popovers + the delete-guard dialog. Rendered ONCE (hidden); the island
// clones/positions a menu anchored to the clicked control and fills the guard
// dialog from the server's A-5 `blockers` (rendered verbatim, §8.2 clause 5).
function renderBoardMenus(): string {
  const item = (action: string, label: string, danger = false): string =>
    `<div class="lg-menu-item${danger ? " danger" : ""}" data-menu-action="${action}" role="menuitem" tabindex="-1">${escapeHtml(label)}</div>`;
  const menu = (name: string, inner: string): string =>
    `<div class="lg-menu lg-hidden" data-board-menu="${name}" role="menu">${inner}</div>`;
  return `<div class="lg-board-menus" data-board-menus>
    ${menu("funnel", item("funnel-settings", "Funnel settings") + `<div class="lg-menu-sep"></div>` + item("duplicate", "Duplicate") + item("set-default", "Set as default") + item("move-left", "Move left") + item("move-right", "Move right") + `<div class="lg-menu-sep"></div>` + item("delete", "Delete", true))}
    ${menu("shared-chip", item("ab-slot", "A/B this slot") + item("slot-rule", "Slot rule") + `<div class="lg-menu-sep"></div>` + item("remove", "Remove", true))}
    ${menu("funnel-chip", item("chip-up", "Move up") + item("chip-down", "Move down") + `<div class="lg-menu-sep"></div>` + item("remove", "Remove", true))}
    ${menu("page", item("page-up", "Move up") + item("page-down", "Move down") + `<div class="lg-menu-sep"></div>` + item("page-delete", "Delete page", true))}
  </div>
  <div class="lg-board-guard lg-hidden" data-board-guard role="dialog" aria-modal="true" aria-labelledby="lg-board-guard-title">
    <div class="lg-board-guard-panel">
      <div class="lg-board-guard-head"><h3 id="lg-board-guard-title">Can't delete this funnel</h3></div>
      <div class="lg-board-guard-body" data-board-guard-body></div>
      <div class="lg-board-guard-foot"><button type="button" class="btn btn-outline" data-board-guard-close>Close</button></div>
    </div>
  </div>
  <div class="lg-template-menu lg-hidden" data-template-menu role="menu"></div>`;
}


// P3b relocation (§8.2 CONDUCTOR RULING) — the funnel-builder rebuild dropped
// the old structure panel's "Funnel settings" <details>; that was NOT a
// sanctioned §10 removal. The six controls (opening-lander enable + headline +
// subheadline + hero; the base funnel-design picker; the per-variant auction
// picker) are relocated VERBATIM — same ids, labels, and the SAME existing
// PUT /variants/:id fields — into a dialog opened from the funnel column's
// kebab, in the board's delete-guard dialog vocabulary. Rendered ONCE (hidden);
// the board island re-populates it per-funnel on open from the blob's per-funnel
// `settings` (funnelSettingsForBlob) and PUTs the clicked funnel's ACTIVE
// variant. SSR seeds it from the current (default/first) funnel's active variant
// so the controls carry real current values on first paint. Provenance:
// 5ccf40e:quotes-tabs/funnel.ts (renderStructurePanel <details id=lg-funnel-
// settings>) / 4c9b534:ui-quotes.ts.
function renderFunnelSettingsDialog(
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  current: VariantNode | null,
): string {
  const designOptions = designs
    .map((d) => `<option value="${escapeHtml(d.id)}"${current !== null && d.id === current.funnel_design_id ? " selected" : ""}>${escapeHtml(d.label)}</option>`)
    .join("");
  const auctionOptions = [`<option value="">— none —</option>`]
    .concat(
      auctions.map(
        (a) => `<option value="${a.id}"${current !== null && current.auction_id === a.id ? " selected" : ""}>${escapeHtml(a.auction_name)}</option>`,
      ),
    )
    .join("");
  const variantAttr = current !== null ? escapeHtml(current.public_id) : "";
  return `<div class="lg-board-guard lg-hidden" data-funnel-settings role="dialog" aria-modal="true" aria-labelledby="lg-funnel-settings-title" data-settings-variant="${variantAttr}">
    <div class="lg-board-guard-panel">
      <div class="lg-board-guard-head"><h3 id="lg-funnel-settings-title">Funnel settings</h3></div>
      <div class="lg-fsettings-body">
        <label class="lg-check"><input type="checkbox" id="lg-lander-enabled"${current !== null && current.lander_enabled ? " checked" : ""} /> Enable opening lander</label>
        <div class="form-group"><label class="form-label" for="lg-lander-headline">Lander headline</label><input id="lg-lander-headline" class="form-input" value="${escapeHtml(current?.lander_headline ?? "")}" /></div>
        <div class="form-group"><label class="form-label" for="lg-lander-sub">Lander subheadline</label><input id="lg-lander-sub" class="form-input" value="${escapeHtml(current?.lander_subheadline ?? "")}" /></div>
        <div class="form-group"><label class="form-label" for="lg-lander-hero">Lander hero image URL</label><input id="lg-lander-hero" class="form-input" value="${escapeHtml(current?.lander_hero_media_url ?? "")}" /></div>
        <div class="form-group"><label class="form-label" for="lg-funnel-design">Base visual design</label><select id="lg-funnel-design" class="form-select" aria-label="Funnel design">${designOptions}</select></div>
        <div class="form-group"><label class="form-label" for="lg-auction-id">Auction</label><select id="lg-auction-id" class="form-select" aria-label="Auction">${auctionOptions}</select></div>
      </div>
      <div class="lg-board-guard-foot"><button type="button" class="btn btn-outline" data-funnel-settings-close>Cancel</button><button type="button" class="btn btn-primary" data-funnel-settings-save>Save</button></div>
    </div>
  </div>`;
}


// The active-variant scalars the relocated "Funnel settings" dialog edits, per
// funnel, so the island can re-populate the shared dialog on open. Mirrors the
// funnel.active_variant_public_id resolution the board projection uses.
function funnelSettingsForBlob(f: FunnelNode): Record<string, unknown> | null {
  const vs = f.variants ?? [];
  const activePub = f.active_variant_public_id ?? (primaryVariantOf(vs)?.public_id ?? null);
  const av = vs.find((v) => v.public_id === activePub) ?? primaryVariantOf(vs);
  if (av === null) return null;
  return {
    variant_public_id: av.public_id,
    lander_enabled: av.lander_enabled,
    lander_headline: av.lander_headline ?? "",
    lander_subheadline: av.lander_subheadline ?? "",
    lander_hero_media_url: av.lander_hero_media_url ?? "",
    funnel_design_id: av.funnel_design_id,
    auction_id: av.auction_id,
  };
}


function boardDataBlob(structure: StructureBody, available: AvailableSection[], templates: FrameTemplateItem[]): string {
  const data = {
    quote_public_id: structure.quote.public_id,
    default_funnel_id: structure.quote.default_funnel_id ?? null,
    shared_page_id: structure.shared_page?.page_id ?? null,
    shared_sections: (structure.shared_page?.sections ?? []).map((s) => s.section_public_id),
    funnels: structure.funnels.map((f) => ({
      public_id: f.public_id,
      id: f.id,
      name: f.funnel_name,
      display_order: f.display_order ?? f.id,
      is_default: structure.quote.default_funnel_id === f.id,
      active_variant_public_id: f.active_variant_public_id ?? (primaryVariantOf(f.variants)?.public_id ?? null),
      arms: f.variants.length,
      frame_template_id: f.frame_template_id ?? null,
      // P3b relocation: the active-variant scalars the kebab "Funnel settings"
      // dialog edits (opening-lander / base design / auction), so the island
      // re-populates the shared dialog per-funnel on open.
      settings: funnelSettingsForBlob(f),
      pages: (f.active_variant_pages ?? []).map((p) => ({
        page_id: p.page_id,
        // Full slot detail so a section add/reorder/remove can rebuild the
        // variant PUT `pages` payload faithfully — ab allocations + ruled
        // cases are preserved (candidates are index-aligned with allocations
        // and follow the [unique cases…, default] order the loader emits).
        slots: p.slots.map((s) => ({ slot_id: s.slot_id, kind: s.kind, section_ids: s.candidates.map((c) => c.section_id), allocations: s.allocations ?? null, rules: s.rules ?? null })),
      })),
    })),
    sections: available.map((s) => ({ public_id: s.public_id, name: s.section_name, activity: s.activity, vertical: s.vertical })),
    templates: templates.map((t) => ({ id: t.id, label: t.label })),
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}


// --- the assembled §8.2 Funnel-builder BOARD ---------------------------------
// Signature preserved (ui-quotes.ts composer call site is byte-stable); the
// board reads structure/available/templates/routingData. `variant`/`designs`/
// `auctions`/`sites` are legacy composer args no longer used by the board.
export function renderBuilderPanel(
  structure: StructureBody,
  variant: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
  templates: FrameTemplateItem[],
  sites: PreviewSiteOption[],
  routingData: RoutingBuilderData,
  railData: QuoteRulesRailData,
): string {
  void variant; void sites; void routingData;
  const funnels = structure.funnels
    .slice()
    .sort((a, b) => (a.display_order ?? a.id) - (b.display_order ?? b.id));
  // The "current" funnel drives the library "In this funnel" badge — the
  // default funnel if set, else the first column.
  const currentFunnelPublicId =
    funnels.find((f) => f.id === structure.quote.default_funnel_id)?.public_id ?? funnels[0]?.public_id ?? "";
  // P3b relocation: SSR-seed the (single, shared) Funnel-settings dialog from
  // the current funnel's ACTIVE variant so the six controls carry real current
  // values on first paint; the island re-populates it per-funnel on kebab open.
  const currentFunnel = funnels.find((f) => f.public_id === currentFunnelPublicId) ?? null;
  const currentSettingsVariant = currentFunnel === null
    ? null
    : (currentFunnel.variants.find((v) => v.public_id === (currentFunnel.active_variant_public_id ?? "")) ?? primaryVariantOf(currentFunnel.variants));
  const funnelCols = funnels.map((f) => renderFunnelColumn(f, structure, templates)).join("");
  return `<div class="lg-qpanel active" data-panel="builder">
  <div class="lg-board-shell" data-pin="8.2-tab-geometry">
    ${renderBoardLibrary(available, structure, currentFunnelPublicId)}
    <div class="lg-board-center">
      <div class="lg-board" data-board data-pin="8.2-board">
        <div class="lg-board-cols" data-board-cols>
          ${renderSharedColumn(structure.shared_page ?? null)}
          ${funnelCols}
          ${renderAddFunnelStub()}
        </div>
      </div>
    </div>
    <div class="lg-board-right" data-rules-rail>
      ${renderQuoteRulesRail(railData)}
    </div>
  </div>
  ${renderBoardMenus()}
  ${renderFunnelSettingsDialog(designs, auctions, currentSettingsVariant)}
  <script type="application/json" id="lg-board-data">${boardDataBlob(structure, available, templates)}</script>
</div>`;
}

// ---------------------------------------------------------------------------
// Editor inline script (strict ES5) — tabs, section-order, rules, save,
// preview, activation, A/B lifecycle, unsaved-changes guard.
// ---------------------------------------------------------------------------

export const QUOTE_EDITOR_SCRIPT = `
(function () {
  var root = document.getElementById('lg-quote-editor');
  if (!root) { return; }
  var dirty = false;
  // Scoped dirty flags (4.7 save-chain semantics): variantDirty gates the
  // variant PUT (section order / lander / design / auction / rules edits);
  // allocDirty tracks the A/B allocation side-save and is cleared by THAT
  // save alone, independent of the main chain. The frame/theme/overrides
  // flags live with the studio state below. beforeunload arms on ANY of them.
  var variantDirty = false;
  var allocDirty = false;
  function markDirty() { dirty = true; }
  function markVariantDirty() { variantDirty = true; dirty = true; }

  var quotePublicId = root.getAttribute('data-quote-public-id') || '';
  var variantPublicId = root.getAttribute('data-variant-public-id') || '';

  function byId(id) { return document.getElementById(id); }
  function showMsg(id, text) { var el = byId(id); if (el) { el.textContent = text; el.hidden = false; } }
  function hideMsg(id) { var el = byId(id); if (el) { el.hidden = true; } }

  // --- 05 5.2 activation-preflight panel (server-verdict-driven re-render) --
  // The SAME operator copy the SSR panel renders; rebuilt after variant save,
  // after an activation PUT, and from the activation 409 report body. DOM is
  // built with createTextNode only (no HTML injection).
  var PREFLIGHT_CODE_LABELS = ${JSON.stringify(PREFLIGHT_BLOCK_CODE_LABELS)};
  var ELIGIBILITY_REASON_LABELS = ${JSON.stringify(LEADGEN_ELIGIBILITY_REASON_LABELS)};
  var PREFLIGHT_PASS_CHECKS = ${JSON.stringify(PREFLIGHT_PASS_CHECKS)};
  var REGION_LABELS = ${JSON.stringify(FRAME_REGION_LABELS)};
  var OVERRIDE_LABELS = ${JSON.stringify(OVERRIDE_GROUP_LABELS)};
  var TOKEN_ROLES = ${JSON.stringify(FUNNEL_TOKEN_ROLES)};
  var PROBLEM_SCOPES = ${JSON.stringify(PROBLEM_SCOPE_ORDER)};
  var PROBLEM_SCOPE_NAMES = ${JSON.stringify(PROBLEM_SCOPE_LABELS)};

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function preflightCodeLabel(code) { return PREFLIGHT_CODE_LABELS[code] || String(code || '').replace(/_/g, ' '); }
  function eligibilityLabel(code) { return ELIGIBILITY_REASON_LABELS[code] || String(code || '').replace(/_/g, ' '); }

  // 14 14.2 — the publish chip copy w/ counts (mirrors the SSR renderer):
  // "Blocked (2 errors)" / "Ready (3 warnings)" / "Ready".
  function publishChipText(errors, warnings) {
    if (errors > 0) { return 'Blocked (' + errors + (errors === 1 ? ' error' : ' errors') + ')'; }
    if (warnings > 0) { return 'Ready (' + warnings + (warnings === 1 ? ' warning' : ' warnings') + ')'; }
    return 'Ready';
  }

  function updatePublishBadge(preflight) {
    var badge = byId('lg-publish-badge');
    if (!badge || !preflight) { return; }
    var problems = preflight.problems || [];
    var errors = (preflight.blocks || []).length;
    var warnings = 0;
    var i;
    for (i = 0; i < problems.length; i++) {
      if (problems[i] && problems[i].severity === 'error') { errors++; }
      else if (problems[i] && problems[i].severity === 'warning') { warnings++; }
    }
    var ok = errors === 0;
    badge.className = 'lg-chip lg-publish-chip';
    badge.setAttribute('data-publish-verdict', ok ? 'ok' : 'blocked');
    badge.setAttribute('data-publish-errors', String(errors));
    badge.setAttribute('data-publish-warnings', String(warnings));
    clearChildren(badge);
    badge.appendChild(document.createTextNode(publishChipText(errors, warnings)));
  }

  function preflightFixLink(href, label) {
    var a = document.createElement('a');
    a.className = 'btn btn-sm btn-secondary';
    a.setAttribute('href', href);
    a.appendChild(document.createTextNode(label));
    return a;
  }

  function preflightBlockCard(b) {
    var card = document.createElement('div');
    card.className = 'lg-preflight-block';
    card.setAttribute('data-preflight-code', b.code || '');
    var parts = [];
    if (b.section_name) { parts.push('Section: ' + b.section_name); }
    if (b.offer_name) { parts.push('Offer: ' + b.offer_name); }
    var fields = b.fields || [];
    var mapped = [];
    var j;
    for (j = 0; j < fields.length; j++) {
      mapped.push(b.code === 'offer_ineligible' ? eligibilityLabel(fields[j]) : fields[j]);
    }
    parts.push(preflightCodeLabel(b.code) + (mapped.length > 0 ? ': ' + mapped.join(', ') : ''));
    var text = document.createElement('span');
    text.appendChild(document.createTextNode(parts.join(' \\u00b7 ')));
    card.appendChild(text);
    var links = b.fix_links || {};
    if (links.section_mapping) { card.appendChild(preflightFixLink(links.section_mapping, 'Open Section Mapping')); }
    if (links.offer_schema) { card.appendChild(preflightFixLink(links.offer_schema, 'Open Offer Payload Schema')); }
    return card;
  }

  // 14 14.2 (C2 LIVE): the fix-link label derives from the server fix_url —
  // the SAME rule as the SSR problemFixLabel.
  function problemFixLabel(url) {
    var u = String(url || '');
    if (u.indexOf('/admin/settings') === 0) { return 'Open site settings'; }
    if (u.indexOf('/sections/') !== -1) { return 'Review slide'; }
    if (u.indexOf('/quotes/') !== -1) { return 'Open Quote Builder'; }
    return 'Fix';
  }

  function problemRowNode(p) {
    var row = document.createElement('div');
    row.className = 'lg-problem-row';
    row.setAttribute('data-problem-severity', p.severity || '');
    row.setAttribute('data-problem-path', p.path || '');
    var chip = document.createElement('span');
    chip.className = 'lg-problem-chip';
    chip.setAttribute('data-severity', p.severity || '');
    chip.appendChild(document.createTextNode(p.severity === 'error' ? 'Error' : 'Warning'));
    row.appendChild(chip);
    var msg = document.createElement('span');
    msg.className = 'lg-problem-msg';
    msg.appendChild(document.createTextNode(p.message || ''));
    row.appendChild(msg);
    if (p.fix_url) { row.appendChild(preflightFixLink(p.fix_url, problemFixLabel(p.fix_url))); }
    return row;
  }

  // 14 14.2: problems[] grouped by scope (fixed order, unknown scopes
  // appended) — the SSR renderProblemsSection markup, DOM-built.
  function appendProblemGroups(panel, problems) {
    if (!problems || problems.length === 0) { return; }
    var wrap = document.createElement('div');
    wrap.id = 'lg-preflight-problems';
    wrap.setAttribute('data-problem-count', String(problems.length));
    var scopes = [];
    var i, j, s;
    for (i = 0; i < PROBLEM_SCOPES.length; i++) { scopes.push(PROBLEM_SCOPES[i]); }
    for (i = 0; i < problems.length; i++) {
      s = problems[i] && problems[i].scope ? problems[i].scope : '';
      if (s && scopes.indexOf(s) === -1) { scopes.push(s); }
    }
    for (i = 0; i < scopes.length; i++) {
      var rows = [];
      for (j = 0; j < problems.length; j++) {
        if (problems[j] && problems[j].scope === scopes[i]) { rows.push(problems[j]); }
      }
      if (rows.length === 0) { continue; }
      var group = document.createElement('div');
      group.className = 'lg-problem-group';
      group.setAttribute('data-problem-scope', scopes[i]);
      var title = document.createElement('h4');
      title.className = 'lg-problem-group-title';
      title.appendChild(document.createTextNode(PROBLEM_SCOPE_NAMES[scopes[i]] || scopes[i]));
      group.appendChild(title);
      for (j = 0; j < rows.length; j++) { group.appendChild(problemRowNode(rows[j])); }
      wrap.appendChild(group);
    }
    panel.appendChild(wrap);
  }

  function renderPreflight(preflight) {
    var panel = byId('lg-preflight-panel');
    if (!panel || !preflight) { return; }
    clearChildren(panel);
    var problems = preflight.problems || [];
    var hasErrorProblems = false;
    var i;
    for (i = 0; i < problems.length; i++) {
      if (problems[i] && problems[i].severity === 'error') { hasErrorProblems = true; }
    }
    // C2 LIVE: blocked exactly when the activation PUT would 409 (blocks OR
    // any error-severity problem); warnings never block.
    panel.setAttribute('data-preflight-state', (preflight.ok && !hasErrorProblems) ? 'pass' : 'blocked');
    updatePublishBadge(preflight);
    if (preflight.ok && !hasErrorProblems) {
      var okTitle = document.createElement('p');
      okTitle.className = 'lg-preflight-ok-title';
      okTitle.appendChild(document.createTextNode('Ready to activate \\u2014 all preflight checks pass.'));
      panel.appendChild(okTitle);
      var ul = document.createElement('ul');
      ul.className = 'lg-preflight-pass';
      for (i = 0; i < PREFLIGHT_PASS_CHECKS.length; i++) {
        var li = document.createElement('li');
        li.setAttribute('data-preflight-check', PREFLIGHT_PASS_CHECKS[i].id);
        li.appendChild(document.createTextNode('\\u2713 ' + PREFLIGHT_PASS_CHECKS[i].label));
        ul.appendChild(li);
      }
      panel.appendChild(ul);
      appendProblemGroups(panel, problems);
      return;
    }
    var title = document.createElement('p');
    title.className = 'lg-preflight-blocked-title';
    title.appendChild(document.createTextNode('Cannot activate this Quote.'));
    panel.appendChild(title);
    var blocks = preflight.blocks || [];
    for (i = 0; i < blocks.length; i++) { panel.appendChild(preflightBlockCard(blocks[i])); }
    appendProblemGroups(panel, problems);
  }

  // --- variant switch: reload the editor scoped to the chosen variant -------
  var variantSelect = byId('lg-variant-select');
  if (variantSelect) {
    variantSelect.addEventListener('change', function () {
      window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/edit?variant=' + encodeURIComponent(this.value);
    });
  }

  // --- 4.1 quote-name inline edit (DEV-60 b) --------------------------------
  // Its OWN save path: PATCH /quotes/:id {quote_name} the moment the operator
  // confirms — never part of the 4.7 Save chain, never arms beforeunload
  // (the input is listed in NON_PERSISTED_IDS below).
  (function () {
    var renameBtn = byId('lg-quote-rename');
    var editor = byId('lg-quote-rename-editor');
    var input = byId('lg-quote-rename-input');
    var title = byId('lg-quote-title');
    if (!renameBtn || !editor || !input || !title) { return; }
    function openRename() {
      input.value = title.textContent || '';
      editor.className = 'lg-rename-editor';
      renameBtn.className = 'btn btn-sm btn-outline lg-hidden';
      if (input.focus) { input.focus(); }
    }
    function closeRename() {
      editor.className = 'lg-rename-editor lg-hidden';
      renameBtn.className = 'btn btn-sm btn-outline';
    }
    function saveRename() {
      var name = (input.value || '').trim();
      if (name === '') { showMsg('lg-quote-error', 'Quote name cannot be empty.'); return; }
      var saveEl = byId('lg-quote-rename-save');
      if (saveEl) { saveEl.disabled = true; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ quote_name: name })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        if (saveEl) { saveEl.disabled = false; }
        if (!res.ok) {
          showMsg('lg-quote-error', (res.body && res.body.fields && res.body.fields.quote_name) ? res.body.fields.quote_name : ((res.body && res.body.error) ? res.body.error : 'Rename failed'));
          return;
        }
        hideMsg('lg-quote-error');
        clearChildren(title);
        title.appendChild(document.createTextNode((res.body && res.body.quote_name) ? res.body.quote_name : name));
        closeRename();
        showMsg('lg-quote-ok', 'Quote renamed.');
      }).catch(function () {
        if (saveEl) { saveEl.disabled = false; }
        showMsg('lg-quote-error', 'Rename failed: network error');
      });
    }
    renameBtn.addEventListener('click', openRename);
    var saveBtnEl = byId('lg-quote-rename-save');
    if (saveBtnEl) { saveBtnEl.addEventListener('click', saveRename); }
    var cancelBtnEl = byId('lg-quote-rename-cancel');
    if (cancelBtnEl) { cancelBtnEl.addEventListener('click', closeRename); }
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { if (ev.preventDefault) { ev.preventDefault(); } saveRename(); return; }
      if (ev.key === 'Escape') { closeRename(); }
    });
  }());

  // --- sub-tab switching ----------------------------------------------------
  var tabs = root.querySelectorAll('.lg-qtab');
  var panels = root.querySelectorAll('.lg-qpanel');
  function activate(name) {
    var i;
    for (i = 0; i < tabs.length; i++) {
      if (tabs[i].getAttribute('data-tab') === name) { tabs[i].className = 'lg-qtab active'; } else { tabs[i].className = 'lg-qtab'; }
    }
    for (i = 0; i < panels.length; i++) {
      if (panels[i].getAttribute('data-panel') === name) { panels[i].className = 'lg-qpanel active'; } else { panels[i].className = 'lg-qpanel'; }
    }
    if (name === 'analytics') { loadAnalytics(); }
    // Round-4 P5b: repaint on every switch into 'templates'/'themes' so the
    // box-picker controls (A/B share data-frame-key with the canvas-click
    // Header/Background inspectors) and the moved theme editor never show a
    // stale value.
    if (name === 'templates' || name === 'themes') { populateAllControls(); }
    if (name === 'themes') { themeMiniOpen = true; scheduleMiniPreview(); loadThemePresetOptions(); }
  }
  var ti;
  for (ti = 0; ti < tabs.length; ti++) {
    tabs[ti].addEventListener('click', function () { activate(this.getAttribute('data-tab')); });
  }
  // Generic data-goto-tab click delegation (the head's Publish button jumps
  // into Activation; the board's A/B badge / theme pickchip jump into A/B /
  // Themes via this SAME mechanism, gotoTab() in the board island below).
  // Historical note (Round-4 P4b, since superseded by the P3b board rebuild):
  // routing rules were briefly a standalone top tab, then moved inside the
  // Funnel builder tab's right column; that link + its embedding are both
  // long gone (§10) — the §8.2 RIGHT rail is the current routing-rules home.
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el.getAttribute && !el.getAttribute('data-goto-tab')) { el = el.parentNode; }
    if (el && el.getAttribute) {
      var target = el.getAttribute('data-goto-tab');
      if (target === 'rules') {
        activate('builder');
        var rulesPanel = document.getElementById('lg-routing-rules-root');
        if (rulesPanel && rulesPanel.scrollIntoView) { rulesPanel.scrollIntoView({ block: 'start' }); }
        return;
      }
      activate(target);
    }
  });

  // --- Round-4 P3b: pages-first funnel structure ----------------------------
  // The panel is ordered PAGES (first-class rows); each page holds nested
  // section SLOTS (fixed / ruled / A/B). Every DOM mutation funnels into
  // renumber() (page badges + the single after-the-last-page auction marker) +
  // markVariantDirty(). collectSections() below stays as the flat fixed-slot
  // reader the 4.7 legacy sections fallback + the seam harness use.
  var sectionList = byId('lg-section-list');
  function trimStr(s) { return String(s).replace(/^\\s+|\\s+$/g, ''); }
  function ancestorWith(el, attr) {
    var n = el;
    while (n && n.getAttribute) {
      if (n.hasAttribute && n.hasAttribute(attr)) { return n; }
      n = n.parentNode;
    }
    return null;
  }
  function pageOf(el) { return ancestorWith(el, 'data-page'); }
  function slotOf(el) { return ancestorWith(el, 'data-slot'); }
  function currentPages() { return sectionList ? sectionList.querySelectorAll('[data-page]') : []; }
  function cloneTpl(id, selector) {
    var tpl = byId(id);
    if (!tpl || !tpl.content) { return null; }
    var frag = document.importNode(tpl.content, true);
    return frag.querySelector(selector);
  }
  function optText(sel) { var o = sel && sel.options ? sel.options[sel.selectedIndex] : null; return o ? (o.textContent || '') : ''; }
  // Is the current structure a plain single-section-per-page funnel (no page
  // names, every slot fixed)? Drives ONLY the auction-marker vocabulary:
  // "slide" stays for a flat funnel (a page IS one slide there), "page" is used
  // once the funnel genuinely branches into multi-slot / ruled / A/B pages.
  function structureIsFlatDom() {
    var pages = currentPages();
    if (!pages.length) { return true; }
    var i;
    for (i = 0; i < pages.length; i++) {
      var nameEl = pages[i].querySelector('[data-page-name]');
      if (nameEl && nameEl.value && trimStr(nameEl.value) !== '') { return false; }
      var slots = pages[i].querySelectorAll('[data-slot]');
      if (slots.length !== 1) { return false; }
      if (slots[0].getAttribute('data-slot-kind') !== 'fixed') { return false; }
    }
    return true;
  }
  function renumber() {
    if (!sectionList) { return; }
    var pages = currentPages();
    var i;
    for (i = 0; i < pages.length; i++) {
      var num = pages[i].querySelector('[data-page-num]');
      if (num) { num.textContent = String(i + 1); }
    }
    var marks = sectionList.querySelectorAll('.lg-auction-entry-mark');
    for (i = 0; i < marks.length; i++) { if (marks[i].parentNode) { marks[i].parentNode.removeChild(marks[i]); } }
    if (pages.length > 0) {
      var last = pages[pages.length - 1];
      var mark = document.createElement('div');
      mark.className = 'lg-auction-entry-mark';
      mark.setAttribute('data-auction-entry', '1');
      mark.appendChild(document.createTextNode(structureIsFlatDom() ? 'Auction runs after this slide' : 'Auction runs after the last page'));
      if (last.nextSibling) { last.parentNode.insertBefore(mark, last.nextSibling); } else { last.parentNode.appendChild(mark); }
    }
    var empty = sectionList.querySelector('[data-empty-sections]');
    if (empty && empty.parentNode) { empty.parentNode.removeChild(empty); }
  }

  // A fixed-slot node built from an add-picker <option> (numeric value + the
  // data-section-* mirror attributes DEV-59 threads onto the option).
  function fixedSlotFromOption(opt, numericId) {
    var slot = cloneTpl('lg-slot-fixed-tpl', '.lg-slot');
    if (!slot) { return null; }
    var row = slot.querySelector('.lg-section-row');
    if (row) {
      row.setAttribute('data-section-id', numericId);
      row.setAttribute('data-section-public-id', opt ? (opt.getAttribute('data-section-public') || '') : '');
      var nameEl = row.querySelector('[data-section-name]');
      if (nameEl) { nameEl.textContent = opt ? (opt.getAttribute('data-section-name') || '') : ''; }
      var dotEl = row.querySelector('.lg-map-dot');
      if (dotEl && opt) {
        var dotStatus = opt.getAttribute('data-mapping-status') || 'none';
        if (dotStatus !== 'complete' && dotStatus !== 'incomplete') { dotStatus = 'none'; }
        dotEl.setAttribute('data-mapping-status', dotStatus);
        dotEl.title = dotStatus === 'complete' ? 'Offer mapping complete'
          : dotStatus === 'incomplete' ? 'Offer mapping incomplete'
          : 'No Offers selected yet';
      }
    }
    return slot;
  }
  function appendPage(page) {
    if (!sectionList || !page) { return; }
    var mark = sectionList.querySelector('.lg-auction-entry-mark');
    if (mark) { sectionList.insertBefore(page, mark); } else { sectionList.appendChild(page); }
  }

  // Top-level "+ Add section" adds the picked section AS A NEW PAGE (one fixed
  // slot); "+ Add page" adds an empty page.
  var addSectionBtn = byId('lg-add-section');
  if (addSectionBtn) {
    addSectionBtn.addEventListener('click', function () {
      var sel = byId('lg-add-section-select');
      if (!sel || !sel.value) { return; }
      var page = cloneTpl('lg-page-tpl', '.lg-page');
      if (!page) { return; }
      var wrap = page.querySelector('[data-page-slots]');
      var slot = fixedSlotFromOption(sel.options[sel.selectedIndex], sel.value);
      if (wrap && slot) { wrap.appendChild(slot); }
      appendPage(page);
      renumber();
      markVariantDirty();
    });
  }
  var addPageBtn = byId('lg-add-page');
  if (addPageBtn) {
    addPageBtn.addEventListener('click', function () {
      var page = cloneTpl('lg-page-tpl', '.lg-page');
      if (page) { appendPage(page); renumber(); markVariantDirty(); }
    });
  }

  function prevPage(page) { var n = page.previousElementSibling; while (n && !(n.getAttribute && n.hasAttribute('data-page'))) { n = n.previousElementSibling; } return n; }
  function nextPage(page) { var n = page.nextElementSibling; while (n && !(n.getAttribute && n.hasAttribute('data-page'))) { n = n.nextElementSibling; } return n; }
  function prevSlot(slot) { var n = slot.previousElementSibling; while (n && !(n.getAttribute && n.hasAttribute('data-slot'))) { n = n.previousElementSibling; } return n; }
  function nextSlot(slot) { var n = slot.nextElementSibling; while (n && !(n.getAttribute && n.hasAttribute('data-slot'))) { n = n.nextElementSibling; } return n; }

  function movePage(page, dir) {
    if (!page || !page.parentNode) { return; }
    if (dir < 0) { var p = prevPage(page); if (p) { page.parentNode.insertBefore(page, p); renumber(); markVariantDirty(); } }
    else { var n = nextPage(page); if (n) { page.parentNode.insertBefore(n, page); renumber(); markVariantDirty(); } }
  }
  function removePage(page) {
    if (!page) { return; }
    if (currentPages().length <= 1) { window.alert('A funnel needs at least one page. Add another page before removing this one.'); return; }
    var wrap = page.querySelector('[data-page-slots]');
    var slots = wrap ? wrap.querySelectorAll('[data-slot]') : [];
    if (slots.length > 0) {
      if (!window.confirm('Remove this page? Its ' + slots.length + ' section' + (slots.length === 1 ? '' : 's') + ' will move to the neighbouring page.')) { return; }
      var neighbor = prevPage(page) || nextPage(page);
      var target = neighbor ? neighbor.querySelector('[data-page-slots]') : null;
      if (target) { var i; for (i = 0; i < slots.length; i++) { target.appendChild(slots[i]); } }
    } else if (!window.confirm('Remove this empty page?')) { return; }
    if (page.parentNode) { page.parentNode.removeChild(page); }
    renumber();
    markVariantDirty();
  }
  function addSlotToPage(page) {
    if (!page) { return; }
    var sel = page.querySelector('[data-add-slot-select]');
    if (!sel || !sel.value) { return; }
    var wrap = page.querySelector('[data-page-slots]');
    var slot = fixedSlotFromOption(sel.options[sel.selectedIndex], sel.value);
    if (wrap && slot) { wrap.appendChild(slot); renumber(); markVariantDirty(); }
  }
  function removeSlot(slot) { if (slot && slot.parentNode) { slot.parentNode.removeChild(slot); renumber(); markVariantDirty(); } }
  function moveSlot(slot, dir) {
    if (!slot || !slot.parentNode) { return; }
    if (dir < 0) { var p = prevSlot(slot); if (p) { slot.parentNode.insertBefore(slot, p); renumber(); markVariantDirty(); } }
    else { var n = nextSlot(slot); if (n) { slot.parentNode.insertBefore(n, slot); renumber(); markVariantDirty(); } }
  }
  function moveSlotAcross(slot, dir) {
    if (!slot) { return; }
    var page = pageOf(slot);
    if (!page) { return; }
    var target = dir < 0 ? prevPage(page) : nextPage(page);
    if (!target) { window.alert(dir < 0 ? 'This is already the first page.' : 'This is already the last page.'); return; }
    var wrap = target.querySelector('[data-page-slots]');
    if (wrap) { wrap.appendChild(slot); renumber(); markVariantDirty(); }
  }

  // A/B + ruled editor mutations.
  function updateAbSum(slot) {
    if (!slot) { return; }
    var cands = slot.querySelectorAll('[data-ab-cand]');
    var sum = 0, i;
    for (i = 0; i < cands.length; i++) { var pctEl = cands[i].querySelector('[data-ab-pct]'); var v = pctEl ? Number(pctEl.value) : 0; if (isFinite(v)) { sum += v; } }
    var sumEl = slot.querySelector('[data-ab-sum]');
    if (sumEl) { sumEl.textContent = 'Total: ' + sum + '%'; }
  }
  function addAbCand(slot) {
    if (!slot) { return; }
    var wrap = slot.querySelector('[data-ab-cands]');
    var cand = cloneTpl('lg-ab-cand-tpl', '.lg-ab-cand');
    if (wrap && cand) { wrap.appendChild(cand); updateAbSum(slot); markVariantDirty(); }
  }
  function removeAbCand(el) {
    var cand = ancestorWith(el, 'data-ab-cand');
    var slot = slotOf(el);
    if (cand && cand.parentNode) { cand.parentNode.removeChild(cand); updateAbSum(slot); markVariantDirty(); }
  }
  function addRuledCase(slot) {
    if (!slot) { return; }
    var wrap = slot.querySelector('[data-ruled-cases]');
    var c = cloneTpl('lg-ruled-case-tpl', '.lg-ruled-case');
    if (wrap && c) { wrap.appendChild(c); markVariantDirty(); }
  }
  function removeRuledCase(el) {
    var c = ancestorWith(el, 'data-ruled-case');
    if (c && c.parentNode) { c.parentNode.removeChild(c); markVariantDirty(); }
  }

  // Kind switch: rebuild the slot body from the target template, seeding it
  // with whatever section refs the old body held so nothing is silently lost.
  function slotSectionRefs(slot) {
    var refs = [];
    var kind = slot.getAttribute('data-slot-kind');
    var i;
    if (kind === 'fixed') {
      var row = slot.querySelector('.lg-section-row');
      if (row) { var nameEl = row.querySelector('[data-section-name]'); refs.push({ id: row.getAttribute('data-section-public-id') || row.getAttribute('data-section-id') || '', name: nameEl ? (nameEl.textContent || '') : '' }); }
    } else if (kind === 'ab') {
      var cands = slot.querySelectorAll('[data-ab-cand]');
      for (i = 0; i < cands.length; i++) { var s = cands[i].querySelector('[data-ab-section]'); if (s && s.value) { refs.push({ id: s.value, name: optText(s) }); } }
    } else if (kind === 'ruled') {
      var d = slot.querySelector('[data-ruled-default]'); if (d && d.value) { refs.push({ id: d.value, name: optText(d) }); }
    }
    return refs;
  }
  function seedSlot(fresh, kind, refs) {
    var i;
    if (kind === 'fixed') {
      var row = fresh.querySelector('.lg-section-row');
      if (row && refs.length > 0) {
        row.setAttribute('data-section-id', refs[0].id);
        row.setAttribute('data-section-public-id', refs[0].id);
        var nameEl = row.querySelector('[data-section-name]'); if (nameEl) { nameEl.textContent = refs[0].name; }
      }
    } else if (kind === 'ab') {
      var cands = fresh.querySelectorAll('[data-ab-cand]');
      for (i = 0; i < refs.length && i < cands.length; i++) { var s = cands[i].querySelector('[data-ab-section]'); if (s) { s.value = refs[i].id; } }
      updateAbSum(fresh);
    } else if (kind === 'ruled' && refs.length > 0) {
      var d = fresh.querySelector('[data-ruled-default]'); if (d) { d.value = refs[0].id; }
    }
  }
  function switchSlotKind(slot, kind) {
    if (!slot || slot.getAttribute('data-slot-kind') === kind) { return; }
    var tplId = kind === 'ab' ? 'lg-slot-ab-tpl' : kind === 'ruled' ? 'lg-slot-ruled-tpl' : 'lg-slot-fixed-tpl';
    var fresh = cloneTpl(tplId, '.lg-slot');
    if (!fresh) { return; }
    seedSlot(fresh, kind, slotSectionRefs(slot));
    if (slot.parentNode) { slot.parentNode.insertBefore(fresh, slot); slot.parentNode.removeChild(slot); }
    renumber();
    markVariantDirty();
  }

  if (sectionList) {
    sectionList.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute || !el.hasAttribute) { return; }
      if (el.hasAttribute('data-page-up')) { movePage(pageOf(el), -1); return; }
      if (el.hasAttribute('data-page-down')) { movePage(pageOf(el), 1); return; }
      if (el.hasAttribute('data-page-remove')) { removePage(pageOf(el)); return; }
      if (el.hasAttribute('data-add-slot')) { addSlotToPage(pageOf(el)); return; }
      if (el.hasAttribute('data-ab-add')) { addAbCand(slotOf(el)); return; }
      if (el.hasAttribute('data-ab-cand-remove')) { removeAbCand(el); return; }
      if (el.hasAttribute('data-ruled-add')) { addRuledCase(slotOf(el)); return; }
      if (el.hasAttribute('data-ruled-case-remove')) { removeRuledCase(el); return; }
      if (el.hasAttribute('data-remove-section')) { removeSlot(slotOf(el)); return; }
      if (el.hasAttribute('data-move-up')) { moveSlot(slotOf(el), -1); return; }
      if (el.hasAttribute('data-move-down')) { moveSlot(slotOf(el), 1); return; }
      if (el.hasAttribute('data-slot-move-prev')) { moveSlotAcross(slotOf(el), -1); return; }
      if (el.hasAttribute('data-slot-move-next')) { moveSlotAcross(slotOf(el), 1); return; }
    });
    sectionList.addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el || !el.hasAttribute) { return; }
      if (el.hasAttribute('data-slot-kind-select')) { switchSlotKind(slotOf(el), el.value); return; }
      if (el.hasAttribute('data-ab-pct')) { updateAbSum(slotOf(el)); return; }
    });
  }

  // --- within-page slot drag (the ui-payload-builder idiom, kept cheap): a
  // handle drag reorders a slot inside its OWN page; cross-page moves use the
  // ◀/▶ buttons. Boot only attaches listeners, so a page-less harness mount is
  // unaffected.
  if (sectionList) {
    (function () {
      var dragEl = null;
      function clearDragOver() {
        var rows = sectionList.querySelectorAll('.lg-slot');
        var i;
        for (i = 0; i < rows.length; i++) { rows[i].className = String(rows[i].className).replace(/\\s*lg-drag-over/g, ''); }
      }
      sectionList.addEventListener('dragstart', function (ev) {
        var t = ev.target;
        if (!t || !t.getAttribute || t.getAttribute('data-drag-handle') === null) { return; }
        dragEl = slotOf(t);
        if (dragEl && ev.dataTransfer) { try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', ''); } catch (dragErr) { /* engines without drag data */ } }
      });
      sectionList.addEventListener('dragover', function (ev) {
        if (dragEl === null) { return; }
        var over = slotOf(ev.target);
        if (!over || over === dragEl || over.parentNode !== dragEl.parentNode) { return; }
        if (ev.preventDefault) { ev.preventDefault(); }
        if (ev.dataTransfer) { ev.dataTransfer.dropEffect = 'move'; }
        clearDragOver();
        over.className = String(over.className).replace(/\\s*lg-drag-over/g, '') + ' lg-drag-over';
      });
      sectionList.addEventListener('dragleave', function (ev) {
        var over = slotOf(ev.target);
        if (over) { over.className = String(over.className).replace(/\\s*lg-drag-over/g, ''); }
      });
      sectionList.addEventListener('drop', function (ev) {
        clearDragOver();
        if (dragEl === null) { return; }
        var target = slotOf(ev.target);
        var moving = dragEl;
        dragEl = null;
        if (!target || target === moving || target.parentNode !== moving.parentNode) { return; }
        if (ev.preventDefault) { ev.preventDefault(); }
        var parent = moving.parentNode;
        var slots = parent.querySelectorAll('[data-slot]');
        var from = -1, to = -1, i;
        for (i = 0; i < slots.length; i++) { if (slots[i] === moving) { from = i; } if (slots[i] === target) { to = i; } }
        if (from < 0 || to < 0) { return; }
        if (from < to) { if (target.nextSibling) { parent.insertBefore(moving, target.nextSibling); } else { parent.appendChild(moving); } }
        else { parent.insertBefore(moving, target); }
        renumber();
        markVariantDirty();
      });
      sectionList.addEventListener('dragend', function () { dragEl = null; clearDragOver(); });
    }());
  }

  // --- rules ----------------------------------------------------------------
  var ruleList = byId('lg-rule-list');
  var addRuleBtn = byId('lg-add-rule');
  if (addRuleBtn) {
    addRuleBtn.addEventListener('click', function () {
      var tpl = byId('lg-rule-row-tpl');
      var frag = tpl.content ? document.importNode(tpl.content, true) : null;
      var row = frag ? frag.querySelector('[data-rule-row]') : null;
      if (row) { ruleList.appendChild(row); markVariantDirty(); }
      var empty = ruleList.querySelector('[data-empty-rules]');
      if (empty) { empty.parentNode.removeChild(empty); }
    });
  }
  if (ruleList) {
    ruleList.addEventListener('click', function (ev) {
      var el = ev.target;
      if (el && el.hasAttribute && el.hasAttribute('data-remove-rule')) {
        var row = el;
        while (row && row.getAttribute && !row.hasAttribute('data-rule-row')) { row = row.parentNode; }
        if (row && row.parentNode) { row.parentNode.removeChild(row); markVariantDirty(); }
      }
    });
  }

  // --- collect + save (PUT /variants/:id) -----------------------------------
  // Flat fixed-slot reader — the 4.7 legacy sections replace-set + the seam
  // harness both call it (kept for a page-LESS DOM; the production panel always
  // renders page cards and saves via collectPages()).
  function collectSections() {
    var out = [];
    if (!sectionList) { return out; }
    var rows = sectionList.querySelectorAll('.lg-section-row');
    var i;
    for (i = 0; i < rows.length; i++) {
      var sid = rows[i].getAttribute('data-section-id');
      out.push({ section_id: Number(sid), position: i });
    }
    return out;
  }
  // One slot → the P3a pages slot shape preparePages validates: fixed
  // {kind, section_id}; ab {kind, allocations:[{section_id, bp}]} (Σbp==10000
  // gated server-side, bp == percent*100); ruled {kind, cases:[{conditions:
  // {groups:[{field,op,value}]}, section_id}], default_section_id}. section_id
  // is the section's PUBLIC id (resolveRef accepts it); the fixed row's
  // data-section-public-id falls back to its numeric data-section-id.
  function collectSlot(slotEl) {
    var kind = slotEl.getAttribute('data-slot-kind');
    if (kind === 'ab') {
      var allocs = [];
      var cands = slotEl.querySelectorAll('[data-ab-cand]');
      var i;
      for (i = 0; i < cands.length; i++) {
        var secEl = cands[i].querySelector('[data-ab-section]');
        var pctEl = cands[i].querySelector('[data-ab-pct]');
        var secVal = secEl ? secEl.value : '';
        if (!secVal) { continue; }
        var pct = pctEl ? Number(pctEl.value) : 0;
        if (!isFinite(pct)) { pct = 0; }
        allocs.push({ section_id: secVal, bp: Math.round(pct * 100) });
      }
      return { kind: 'ab', allocations: allocs };
    }
    if (kind === 'ruled') {
      var cases = [];
      var caseEls = slotEl.querySelectorAll('[data-ruled-case]');
      var k;
      for (k = 0; k < caseEls.length; k++) {
        var fEl = caseEls[k].querySelector('[data-ruled-field]');
        var oEl = caseEls[k].querySelector('[data-ruled-op]');
        var vEl = caseEls[k].querySelector('[data-ruled-value]');
        var csEl = caseEls[k].querySelector('[data-ruled-section]');
        var csVal = csEl ? csEl.value : '';
        if (!csVal) { continue; }
        cases.push({ conditions: { groups: [{ field: fEl ? fEl.value : 'state', op: oEl ? oEl.value : 'eq', value: vEl ? vEl.value : '' }] }, section_id: csVal });
      }
      var out = { kind: 'ruled', cases: cases };
      var defEl = slotEl.querySelector('[data-ruled-default]');
      if (defEl && defEl.value) { out.default_section_id = defEl.value; }
      return out;
    }
    // fixed
    var row = slotEl.querySelector('.lg-section-row');
    if (!row) { return null; }
    var fid = row.getAttribute('data-section-public-id') || row.getAttribute('data-section-id') || '';
    if (!fid) { return null; }
    return { kind: 'fixed', section_id: fid };
  }
  function collectPages() {
    var out = [];
    if (!sectionList) { return out; }
    var pages = currentPages();
    var i, j;
    for (i = 0; i < pages.length; i++) {
      var nameEl = pages[i].querySelector('[data-page-name]');
      var name = nameEl && nameEl.value ? trimStr(nameEl.value) : null;
      if (name === '') { name = null; }
      var slots = [];
      var slotEls = pages[i].querySelectorAll('[data-slot]');
      for (j = 0; j < slotEls.length; j++) { var s = collectSlot(slotEls[j]); if (s) { slots.push(s); } }
      out.push({ name: name, slots: slots });
    }
    return out;
  }
  function collectRules() {
    var out = [];
    if (!ruleList) { return out; }
    var rows = ruleList.querySelectorAll('[data-rule-row]');
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var conditions = { groups: [] };
      var cEl = r.querySelector('[data-rule-conditions]');
      if (cEl && cEl.value) { try { conditions = JSON.parse(cEl.value); } catch (e) { conditions = { groups: [] }; } }
      var offerEl = r.querySelector('[data-rule-target-offer]');
      var offerVal = offerEl && offerEl.value ? Number(offerEl.value) : null;
      var prioEl = r.querySelector('[data-rule-priority]');
      var urlEl = r.querySelector('[data-rule-redirect-url]');
      // Round-4 P4b rule-model v2 additive fields — the unified builder's
      // hidden carriers (ui-rules-builder.ts ROUTING_RULES_SCRIPT writes
      // these by row index). target_section_id is a NEW collection (skip_
      // section/show_section had no admin picker before P4b); target_
      // funnel_variant_id rides as a PUBLIC id STRING (quotes-handlers.ts
      // prepareRules resolves it server-side, same-funnel scoped) — the
      // ONE field on this payload that is a public id rather than a raw
      // integer, since it needs cross-funnel-leak validation the numeric
      // target_offer_id/target_section_id path does not.
      var nameEl = r.querySelector('[data-rule-name]');
      var statusEl = r.querySelector('[data-rule-status]');
      var matchModeEl = r.querySelector('[data-rule-match-mode]');
      var sectionEl = r.querySelector('[data-rule-target-section]');
      var sectionVal = sectionEl && sectionEl.value ? Number(sectionEl.value) : null;
      var variantEl = r.querySelector('[data-rule-target-variant]');
      var multEl = r.querySelector('[data-rule-value-multiplier]');
      var multVal = multEl && multEl.value ? Number(multEl.value) : null;
      // §15.5 (0044) redirect_pct — sent for every rule type (harmless/unused
      // by the runtime off redirect_direct_offer); empty carrier -> null (the
      // contract's "no redirect" default), never 0 unless the operator typed it.
      var pctEl = r.querySelector('[data-rule-redirect-pct]');
      var pctVal = pctEl && pctEl.value !== '' ? Number(pctEl.value) : null;
      out.push({
        rule_type: r.querySelector('[data-rule-type]').value,
        target_offer_id: offerVal,
        target_section_id: sectionVal,
        redirect_url: urlEl && urlEl.value ? urlEl.value : null,
        redirect_url_allowlisted: r.querySelector('[data-rule-allowlisted]').checked,
        enabled: r.querySelector('[data-rule-enabled]').checked,
        priority: prioEl && prioEl.value ? Number(prioEl.value) : 100,
        conditions_json: conditions,
        rule_name: nameEl && nameEl.value ? nameEl.value : null,
        status: statusEl && statusEl.value ? statusEl.value : 'active',
        match_mode: matchModeEl && matchModeEl.value ? matchModeEl.value : 'all',
        target_funnel_variant_id: variantEl && variantEl.value ? variantEl.value : null,
        value_multiplier: multVal,
        redirect_pct: pctVal
      });
    }
    return out;
  }
  function collectPayload() {
    // P3b (S3b.1) money-path guard: the funnel-builder BOARD removed the old
    // structure/rules/lander DOM (lg-section-list, lg-lander-*, lg-funnel-
    // design, lg-auction-id, lg-rule-list). This function is only reached when
    // (variantDirty || overridesDirty) — flags the board never sets — but it is
    // hardened regardless: every field is included ONLY when its control is
    // present, and sections/pages/rules are OMITTED when their DOM is absent so
    // a stray Save can never crash (null.checked) NOR replace-set the variant's
    // pages/rules to empty (which would wipe auction_entry rules + the plan).
    var payload = {};
    var landerEn = byId('lg-lander-enabled');
    if (landerEn) { payload.lander_enabled = landerEn.checked; }
    var landerHl = byId('lg-lander-headline');
    if (landerHl) { payload.lander_headline = landerHl.value; }
    var landerSub = byId('lg-lander-sub');
    if (landerSub) { payload.lander_subheadline = landerSub.value; }
    var landerHero = byId('lg-lander-hero');
    if (landerHero) { payload.lander_hero_media_url = landerHero.value; }
    var designSel = byId('lg-funnel-design');
    if (designSel) { payload.funnel_design_id = designSel.value; }
    var auctionSel = byId('lg-auction-id');
    if (auctionSel) { payload.auction_id = auctionSel.value ? Number(auctionSel.value) : null; }
    if (ruleList) { payload.rules = collectRules(); }
    // pages-first replace-set (mutually exclusive with sections), ONLY when the
    // old structure DOM is present. Absent DOM (the board) omits both keys so
    // the variant PUT touches neither (putVariantHandler: absent == no change).
    if (sectionList) {
      if (sectionList.querySelectorAll('[data-page]').length > 0) {
        payload.pages = collectPages();
      } else {
        payload.sections = collectSections();
      }
    }
    // 4.5/4.7 — the sparse per-arm overrides ride the SAME variant PUT, and
    // ONLY when the operator touched them (additive contract; {} clears).
    if (overridesDirty) {
      payload.frame_overrides_json = isEmptyObject(workingOverrides) ? null : workingOverrides;
    }
    return payload;
  }

  function putJson(url, body) {
    return fetch(url, {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  function saveFailureText(res, what) {
    var msg = (res.body && res.body.error) ? (what + ': ' + res.body.error) : (what + ' failed');
    if (res.body && res.body.fields) { msg = msg + ': ' + JSON.stringify(res.body.fields); }
    if (res.body && res.body.problems && res.body.problems.length) {
      var lines = [];
      var i;
      for (i = 0; i < res.body.problems.length; i++) { lines.push(res.body.problems[i].message || ''); }
      msg = msg + ' \\u2014 ' + lines.join(' ');
    }
    return msg;
  }

  // --- 4.7 one-Save: frame PUT (when edited) -> theme PUT (when edited) ->
  // variant PUT (ONLY when order/lander/design/auction/rules or the sparse
  // overrides changed). Each step's dirty flag clears THE MOMENT its own PUT
  // succeeds, so a mid-chain failure leaves only the failed + not-yet-run
  // steps dirty — a Retry re-PUTs just those and can never re-send (and
  // re-bump) an already-saved step. A skipped step resolves {ok, body: null};
  // its flag was already false and stays untouched.
  var saveBtn = byId('lg-variant-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      hideMsg('lg-quote-error'); hideMsg('lg-quote-ok');
      saveBtn.disabled = true;
      var warned = 0;
      var funnelBase = '/api/admin/leadgen/funnels/' + encodeURIComponent(funnelPublicId);
      var step1 = frameDirty
        ? putJson(funnelBase + '/frame', { frame_config_json: workingFrame })
        : Promise.resolve({ ok: true, body: null });
      step1.then(function (res1) {
        if (!res1.ok) { throw new Error(saveFailureText(res1, 'Funnel-layout save')); }
        if (res1.body !== null) { frameDirty = false; }
        if (res1.body && res1.body.problems) { warned += res1.body.problems.length; }
        return themeDirty
          ? putJson(funnelBase + '/theme', { theme_json: workingTheme })
          : Promise.resolve({ ok: true, body: null });
      }).then(function (res2) {
        if (!res2.ok) { throw new Error(saveFailureText(res2, 'Theme save')); }
        if (res2.body !== null) { themeDirty = false; }
        if (res2.body && res2.body.problems) { warned += res2.body.problems.length; }
        return (variantDirty || overridesDirty)
          ? putJson('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId), collectPayload())
          : Promise.resolve({ ok: true, body: null });
      }).then(function (res3) {
        saveBtn.disabled = false;
        if (!res3.ok) { showMsg('lg-quote-error', saveFailureText(res3, 'Save')); return; }
        if (res3.body !== null) { variantDirty = false; overridesDirty = false; }
        dirty = false;
        showMsg('lg-quote-ok', warned > 0 ? 'Saved. ' + warned + ' validation note' + (warned === 1 ? '' : 's') + ' \\u2014 see the Activation tab.' : 'Saved.');
        // 05 5.2 + 14 14.2: a RUN variant PUT recomputes + returns the
        // preflight verdict — refresh the panel + the head publish chip. A
        // SKIPPED variant PUT deliberately leaves both untouched: nothing
        // variant-scoped changed, so the last server-computed verdict (the
        // SSR panel or the previous refresh) still holds — no staleness.
        if (res3.body && res3.body.activation_preflight) { renderPreflight(res3.body.activation_preflight); }
      }).catch(function (err) {
        saveBtn.disabled = false;
        showMsg('lg-quote-error', (err && err.message) ? err.message : 'Network error');
      });
    });
  }

  // ==========================================================================
  // v2.5 04 §4.1 FRAME STUDIO island. State boots from the SSR #lg-quote-data
  // blob (no fetches on boot); every config change round-trips through
  // POST /variants/:id/preview with draft_frame_config/draft_theme — the
  // server render is the canvas authority (client merges only POPULATE the
  // inspector controls). Region select here is CLICK-ONLY (the parent
  // attaches ONE 'click' listener per load — no postMessage bridge, no script
  // injected into the composed page). Because discrete click events DO deliver
  // across a scripts-disabled srcdoc boundary in every engine, this iframe
  // KEEPS sandbox="allow-same-origin" (no allow-scripts): scripts stay inert
  // by the sandbox itself, no CSP meta needed. Contrast the Section-Builder
  // studio canvas (ui-section-studio.ts), which drives HELD-BUTTON page.mouse
  // drags — those DON'T deliver across a scripts-disabled boundary under
  // Chromium, so it grants allow-scripts + a script-src 'none' CSP instead
  // (the U13 fix). No held-button gesture is bound to THIS iframe, so it needs
  // neither.
  // ==========================================================================

  function readBlob(id) {
    var el = byId(id);
    if (!el) { return null; }
    try { return JSON.parse(el.textContent || el.innerText || 'null'); } catch (e) { return null; }
  }
  var lgData = readBlob('lg-quote-data') || {};
  var frameState = lgData.frame || { frame_config: null, effective_frame: null, template_defaults: {}, problems: [] };
  var themeState = lgData.theme || { theme: null, effective_tokens: {}, problems: [] };
  var tokens = themeState.effective_tokens || {};
  var templates = lgData.templates || [];
  var slideList = lgData.sections || [];
  var isControl = lgData.selected_variant_is_control !== false;
  var funnelPublicId = root.getAttribute('data-funnel-public-id') || lgData.funnel_public_id || '';

  function deepClone(v) { return v === null || v === undefined ? {} : JSON.parse(JSON.stringify(v)); }
  function isRecordVal(v) { return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) !== '[object Array]'; }
  function isEmptyObject(v) { return isRecordVal(v) && (function () { for (var k in v) { if (Object.prototype.hasOwnProperty.call(v, k)) { return false; } } return true; }()); }
  // The §13.2 merge mirror (populate-only): objects merge, arrays replace whole.
  function deepMerge(base, patch) {
    if (!isRecordVal(patch)) { return base; }
    var k;
    for (k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) { continue; }
      var v = patch[k];
      if (v === undefined) { continue; }
      if (isRecordVal(v) && isRecordVal(base[k])) { deepMerge(base[k], v); }
      else { base[k] = v === null ? null : (typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v); }
    }
    return base;
  }
  function getPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined || typeof cur !== 'object') { return undefined; }
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!isRecordVal(cur[parts[i]])) { cur[parts[i]] = {}; }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  var workingFrame = deepClone(frameState.frame_config || {});
  var workingTheme = deepClone(themeState.theme || {});
  var workingOverrides = deepClone(lgData.overrides || {});
  var frameDirty = false;
  var themeDirty = false;
  var overridesDirty = false;
  var overrideMode = {};
  var viewport = 'desktop';
  var previewMode = 'section';
  var currentSlideId = slideList.length > 0 ? slideList[0].public_id : null;
  var pages = [];
  var pageIndex = 0;
  // Phase D stepper perf (16 "all-slides stepper perf"): above this slide
  // count, mode:'all' fetches ONE composed page per step (the additive
  // page:k protocol) instead of the full pages[]; at or below it the eager
  // pages[] flow is byte-identical to Phase B. pageCount is the stepper's
  // authoritative total in BOTH flows; knownSectionCount tracks the server's
  // section_count echo (boot value = the SSR slide list).
  var LAZY_SLIDES_THRESHOLD = 8;
  var pageCount = 0;
  var knownSectionCount = slideList.length;
  function lazyAllMode() { return knownSectionCount > LAZY_SLIDES_THRESHOLD; }
  var lastCss = '';
  var selectedRegion = null;
  var siteId = '';
  var pendingSwitch = null;

  function templateDefaults(id) {
    var i;
    for (i = 0; i < templates.length; i++) { if (templates[i].id === id) { return templates[i].defaults || {}; } }
    return templates.length > 0 ? (templates[0].defaults || {}) : {};
  }
  function currentTemplateId() {
    if (workingFrame.template) { return workingFrame.template; }
    if (frameState.effective_frame && frameState.effective_frame.template) { return frameState.effective_frame.template; }
    return 'centered';
  }
  // Populate-only effective config: template defaults + funnel patch +
  // active per-arm override groups (the SERVER recomputes the truth on every
  // preview POST — this only fills control values).
  function clientEffective() {
    var eff = deepClone(templateDefaults(currentTemplateId()));
    var groups = deepClone(workingFrame);
    delete groups.template;
    delete groups.version;
    deepMerge(eff, groups);
    var g;
    for (g in workingOverrides) {
      if (!Object.prototype.hasOwnProperty.call(workingOverrides, g)) { continue; }
      if (g === 'theme' || g === 'template' || g === 'version') { continue; }
      if (isRecordVal(workingOverrides[g])) {
        if (!isRecordVal(eff[g])) { eff[g] = {}; }
        deepMerge(eff[g], workingOverrides[g]);
      }
    }
    return eff;
  }

  // --- override routing (§4.5) ----------------------------------------------
  function writeTargetFor(group) {
    if (!isControl && overrideMode[group] === 'override') { return 'overrides'; }
    return 'frame';
  }
  function writeConfigValue(path, value) {
    var group = path.split('.')[0];
    if (writeTargetFor(group) === 'overrides') {
      setPath(workingOverrides, path, value);
      overridesDirty = true;
    } else {
      setPath(workingFrame, path, value);
      if (workingFrame.template === undefined) { workingFrame.template = currentTemplateId(); }
      workingFrame.version = 1;
      frameDirty = true;
    }
    markDirty();
    updateOverrideBadge();
    schedulePreview();
  }
  function updateOverrideBadge() {
    var badge = byId('lg-override-badge');
    var list = byId('lg-override-badge-list');
    if (!badge || !list) { return; }
    var names = [];
    var g;
    for (g in workingOverrides) {
      if (!Object.prototype.hasOwnProperty.call(workingOverrides, g)) { continue; }
      if (g === 'template' || g === 'version') { continue; }
      if (isRecordVal(workingOverrides[g]) && !isEmptyObject(workingOverrides[g])) { names.push(OVERRIDE_LABELS[g] || g); }
    }
    if (names.length === 0) { badge.className = 'lg-chip lg-override-badge lg-hidden'; return; }
    badge.className = 'lg-chip lg-override-badge';
    clearChildren(list);
    list.appendChild(document.createTextNode(names.join(', ')));
  }
  function initOverrideSwitches() {
    var radios = root.querySelectorAll('[data-override-group]');
    var i;
    for (i = 0; i < radios.length; i++) {
      var group = radios[i].getAttribute('data-override-group');
      if (overrideMode[group] === undefined) {
        overrideMode[group] = isRecordVal(workingOverrides[group]) && !isEmptyObject(workingOverrides[group]) ? 'override' : 'inherit';
      }
      radios[i].checked = radios[i].value === overrideMode[group];
    }
  }
  root.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('data-override-group') === null) { return; }
    var group = el.getAttribute('data-override-group');
    overrideMode[group] = el.value === 'override' ? 'override' : 'inherit';
    if (overrideMode[group] === 'inherit' && workingOverrides[group] !== undefined) {
      delete workingOverrides[group];
      overridesDirty = true;
      markDirty();
    }
    populateAllControls();
    updateOverrideBadge();
    schedulePreview();
  });

  // --- inspector control binding ---------------------------------------------
  // 3.3 kind mirror: these keys are plain text-kind (empty string legal,
  // null rejected) — everything else maps a cleared input to null (the
  // *_or_null kinds inherit/blank that way).
  var NOT_NULLABLE_TEXT_KEYS = { 'back.label': 1, 'disclosure.link_label': 1, 'disclosure.text': 1, 'header.cta.label': 1 };
  function controlValueOf(el, key) {
    if (el.type === 'checkbox') { return el.checked; }
    var v = el.value;
    if (v === '' && NOT_NULLABLE_TEXT_KEYS[key] === 1) { return ''; }
    return v === '' ? null : v;
  }
  root.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var key = el.getAttribute('data-frame-key');
    if (key === null) { return; }
    if (el.type === 'radio' && !el.checked) { return; }
    writeConfigValue(key, controlValueOf(el, key));
  });
  // Manual logo (Advanced, §4.4): the checkbox flips header.logo_source.
  root.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('data-manual-logo') === null) { return; }
    writeConfigValue('header.logo_source', el.checked ? 'manual' : 'site');
  });

  // --- editable lists (arrays replace whole, §13.2) ---------------------------
  var LIST_FIELDS = { 'footer.links': ['label', 'href'], 'trust_strip.logos': ['media_id', 'alt'], 'benefit_bar.items': ['icon', 'text'] };
  function listContainer(key) { return root.querySelector('[data-frame-list="' + key + '"]'); }
  // DEV-60 (a): a curated <select> field must never DESTROY a stored legacy
  // value outside its closed list — populate appends it as a "(stored)"
  // option so the populate→collect round-trip is loss-free.
  function selectHasOption(sel, v) {
    var i;
    var opts = sel.options || [];
    for (i = 0; i < opts.length; i++) { if (opts[i].value === v) { return true; } }
    return false;
  }
  function setListFieldValue(input, val) {
    var tag = String(input.tagName || '').toLowerCase();
    if (tag === 'select' && val !== '' && !selectHasOption(input, val)) {
      var opt = document.createElement('option');
      opt.value = val;
      opt.appendChild(document.createTextNode(val + ' (stored)'));
      input.appendChild(opt);
    }
    input.value = val;
  }
  function fillList(key, rows) {
    var box = listContainer(key);
    var tpl = root.querySelector('template[data-frame-list-tpl="' + key + '"]');
    if (!box || !tpl || !tpl.content) { return; }
    clearChildren(box);
    var i, f;
    for (i = 0; i < (rows || []).length; i++) {
      var frag = document.importNode(tpl.content, true);
      var row = frag.querySelector('.lg-list-row');
      if (!row) { continue; }
      var fields = LIST_FIELDS[key] || [];
      for (f = 0; f < fields.length; f++) {
        var input = row.querySelector('[data-list-field="' + fields[f] + '"]');
        if (input) { setListFieldValue(input, rows[i] && rows[i][fields[f]] !== undefined && rows[i][fields[f]] !== null ? String(rows[i][fields[f]]) : ''); }
      }
      box.appendChild(row);
    }
    var spans = box.querySelectorAll('[data-media-field]');
    for (f = 0; f < spans.length; f++) { syncMediaField(spans[f]); }
  }
  function collectList(key) {
    var box = listContainer(key);
    if (!box) { return []; }
    var out = [];
    var rows = box.querySelectorAll('.lg-list-row');
    var i, f;
    for (i = 0; i < rows.length; i++) {
      var entry = {};
      var any = false;
      var fields = LIST_FIELDS[key] || [];
      for (f = 0; f < fields.length; f++) {
        var input = rows[i].querySelector('[data-list-field="' + fields[f] + '"]');
        var v = input ? input.value : '';
        entry[fields[f]] = v;
        if (v !== '') { any = true; }
      }
      if (any) { out.push(entry); }
    }
    return out;
  }
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var addKey = el.getAttribute('data-add-list-row');
    if (addKey !== null) {
      var rows = collectList(addKey);
      rows.push({});
      fillList(addKey, rows);
      return;
    }
    if (el.getAttribute && el.hasAttribute && el.hasAttribute('data-remove-list-row')) {
      var row = el;
      while (row && row.className !== undefined && String(row.className).indexOf('lg-list-row') < 0) { row = row.parentNode; }
      if (row && row.parentNode) {
        var box = row.parentNode;
        var key = box.getAttribute ? box.getAttribute('data-frame-list') : null;
        row.parentNode.removeChild(row);
        if (key) { writeConfigValue(key, collectList(key)); }
      }
    }
  });
  root.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('data-list-field') === null) { return; }
    var box = el;
    while (box && box.getAttribute && box.getAttribute('data-frame-list') === null) { box = box.parentNode; }
    if (box && box.getAttribute) { writeConfigValue(box.getAttribute('data-frame-list'), collectList(box.getAttribute('data-frame-list'))); }
  });

  // --- 4.4 media pickers (DEV-60 a) — the shared Media-library chooser -------
  // List + upload ride the EXISTING admin media API (GET /api/admin/media,
  // POST /api/admin/media/upload); the picked storage_key lands in the hidden
  // carrier input and flows through the SAME writeConfigValue path a typed
  // value took before.
  function mediaSrc(v) {
    var s = String(v || '');
    if (s === '') { return ''; }
    if (s.charAt(0) === '/' || s.indexOf('http://') === 0 || s.indexOf('https://') === 0 || s.indexOf('data:') === 0) { return s; }
    return '/media/' + s;
  }
  function syncMediaField(span) {
    var input = span.querySelector('input');
    var thumb = span.querySelector('[data-media-thumb]');
    var clearBtn = span.querySelector('[data-media-clear]');
    var v = input ? (input.value || '') : '';
    if (thumb) {
      if (v !== '') { thumb.setAttribute('src', mediaSrc(v)); thumb.className = 'lg-media-thumb'; }
      else { thumb.removeAttribute('src'); thumb.className = 'lg-media-thumb lg-hidden'; }
    }
    if (clearBtn) { clearBtn.className = v !== '' ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-outline lg-hidden'; }
  }
  function syncAllMediaFields() {
    var spans = root.querySelectorAll('[data-media-field]');
    var i;
    for (i = 0; i < spans.length; i++) { syncMediaField(spans[i]); }
  }
  function writeMediaFieldValue(span, value) {
    var input = span.querySelector('input');
    if (!input) { return; }
    input.value = value;
    var frameKey = input.getAttribute('data-frame-key');
    if (frameKey !== null) {
      writeConfigValue(frameKey, value === '' ? null : value);
    } else {
      // Round-4 P5b: a tplbox media field (F brand-logo items) has NEITHER a
      // data-frame-key NOR a data-frame-list ancestor — it lives inside a
      // data-tplbox-list container instead; writeTplboxList (defined below)
      // recollects and writes that group's FULL shape.
      var box = input;
      while (
        box && box.getAttribute &&
        box.getAttribute('data-frame-list') === null &&
        box.getAttribute('data-tplbox-list') === null
      ) { box = box.parentNode; }
      if (box && box.getAttribute && box.getAttribute('data-frame-list') !== null) {
        var listKey = box.getAttribute('data-frame-list');
        writeConfigValue(listKey, collectList(listKey));
      } else if (box && box.getAttribute && box.getAttribute('data-tplbox-list') !== null) {
        writeTplboxList(box.getAttribute('data-tplbox-list'));
      }
    }
    syncMediaField(span);
  }
  var mediaPickerTarget = null;
  function mediaPickerStatus(text) {
    var el = byId('lg-media-picker-status');
    if (el) { clearChildren(el); if (text) { el.appendChild(document.createTextNode(text)); } }
  }
  function closeMediaPicker() {
    var overlay = byId('lg-media-picker');
    if (overlay) { overlay.className = 'lg-media-picker-overlay lg-hidden'; }
    mediaPickerTarget = null;
  }
  function renderMediaGrid(items) {
    var grid = byId('lg-media-picker-grid');
    if (!grid) { return; }
    clearChildren(grid);
    if (!items || items.length === 0) {
      var p = document.createElement('p');
      p.className = 'form-help';
      p.appendChild(document.createTextNode('No images in the Media library yet \\u2014 upload one above.'));
      grid.appendChild(p);
      return;
    }
    var i;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.storage_key) { continue; }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lg-media-item';
      btn.setAttribute('data-media-pick', it.storage_key);
      btn.title = it.filename || it.storage_key;
      var img = document.createElement('img');
      img.setAttribute('src', mediaSrc(it.storage_key));
      img.setAttribute('alt', it.alt_text || it.filename || '');
      btn.appendChild(img);
      var name = document.createElement('span');
      name.appendChild(document.createTextNode(it.filename || it.storage_key));
      btn.appendChild(name);
      grid.appendChild(btn);
    }
  }
  function loadMediaList() {
    mediaPickerStatus('Loading\\u2026');
    fetch('/api/admin/media', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { mediaPickerStatus('Could not load the Media library.'); return; }
        mediaPickerStatus('');
        renderMediaGrid((res.body && res.body.media) || []);
      })
      .catch(function () { mediaPickerStatus('Could not load the Media library.'); });
  }
  function openMediaPicker(fieldSpan) {
    mediaPickerTarget = fieldSpan;
    var overlay = byId('lg-media-picker');
    if (overlay) { overlay.className = 'lg-media-picker-overlay'; }
    loadMediaList();
  }
  function applyMediaPick(storageKey) {
    if (mediaPickerTarget) { writeMediaFieldValue(mediaPickerTarget, storageKey); }
    closeMediaPicker();
  }
  function uploadMediaFile() {
    var fileInput = byId('lg-media-upload-file');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) { mediaPickerStatus('Choose an image file first.'); return; }
    var fd = new FormData();
    fd.append('file', fileInput.files[0]);
    mediaPickerStatus('Uploading\\u2026');
    fetch('/api/admin/media/upload', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.item || !res.body.item.storage_key) {
          mediaPickerStatus((res.body && res.body.error) ? res.body.error : 'Upload failed.');
          return;
        }
        mediaPickerStatus('');
        fileInput.value = '';
        applyMediaPick(res.body.item.storage_key);
      })
      .catch(function () { mediaPickerStatus('Upload failed: network error.'); });
  }
  // FIX 8c (§8.4): "Generate with AI" — the EXISTING admin generation
  // endpoint (POST /api/admin/ai/image writes R2 + the media row); the
  // resulting storage_key flows through the SAME applyMediaPick path an
  // upload takes. Server-hidden when the route is unavailable.
  function generateMediaWithAi() {
    var promptEl = byId('lg-media-ai-prompt');
    var prompt = promptEl && promptEl.value ? String(promptEl.value).replace(/^\\s+|\\s+$/g, '') : '';
    if (prompt === '') { mediaPickerStatus('Describe the image to generate first.'); return; }
    mediaPickerStatus('Generating\\u2026');
    fetch('/api/admin/ai/image', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.storage_key) {
        mediaPickerStatus((res.body && res.body.error) ? res.body.error : 'Image generation failed.');
        return;
      }
      mediaPickerStatus('');
      if (promptEl) { promptEl.value = ''; }
      applyMediaPick(res.body.storage_key);
    }).catch(function () { mediaPickerStatus('Image generation failed: network error.'); });
  }
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    if (el.hasAttribute && el.hasAttribute('data-media-choose')) {
      var span = el;
      while (span && span.getAttribute && span.getAttribute('data-media-field') === null) { span = span.parentNode; }
      if (span && span.getAttribute) { openMediaPicker(span); }
      return;
    }
    if (el.hasAttribute && el.hasAttribute('data-media-clear')) {
      var clearSpan = el;
      while (clearSpan && clearSpan.getAttribute && clearSpan.getAttribute('data-media-field') === null) { clearSpan = clearSpan.parentNode; }
      if (clearSpan && clearSpan.getAttribute) { writeMediaFieldValue(clearSpan, ''); }
      return;
    }
    var pickNode = el;
    while (pickNode && pickNode.getAttribute && pickNode.getAttribute('data-media-pick') === null) { pickNode = pickNode.parentNode; }
    if (pickNode && pickNode.getAttribute) { applyMediaPick(pickNode.getAttribute('data-media-pick')); }
  });
  (function () {
    var closeBtn = byId('lg-media-picker-close');
    if (closeBtn) { closeBtn.addEventListener('click', closeMediaPicker); }
    var uploadBtn = byId('lg-media-upload-btn');
    if (uploadBtn) { uploadBtn.addEventListener('click', uploadMediaFile); }
    var aiBtn = byId('lg-media-ai-generate');
    if (aiBtn) { aiBtn.addEventListener('click', generateMediaWithAi); }
  }());

  // --- role swatches (frame keys + theme palette + theme role picks) ---------
  function resolveRoleValue(role) {
    var pal = workingTheme.palette || {};
    var ov = workingOverrides.theme && workingOverrides.theme.palette ? workingOverrides.theme.palette : {};
    var v = ov[role] !== undefined ? ov[role] : pal[role];
    if (v === undefined || v === null || v === '') { return tokens[role] || ''; }
    if (String(v).charAt(0) === '#') { return String(v); }
    return tokens[v] || tokens[role] || '';
  }
  function paintSwatches() {
    var swatches = root.querySelectorAll('.lg-role-swatch');
    var i;
    for (i = 0; i < swatches.length; i++) {
      swatches[i].style.background = resolveRoleValue(swatches[i].getAttribute('data-role-pick'));
    }
    var themeSw = root.querySelectorAll('[data-theme-role]');
    for (i = 0; i < themeSw.length; i++) {
      var role = themeSw[i].getAttribute('data-theme-role');
      var sw = themeSw[i].querySelector('[data-role-swatch]');
      if (sw) { sw.style.background = resolveRoleValue(role); }
      var src = themeSw[i].querySelector('[data-role-source]');
      if (src) {
        var owned = (workingTheme.palette && workingTheme.palette[role] !== undefined) ||
          (workingOverrides.theme && workingOverrides.theme.palette && workingOverrides.theme.palette[role] !== undefined);
        clearChildren(src);
        src.appendChild(document.createTextNode(owned ? 'This funnel' : 'Base design'));
      }
    }
    paintHarmonyChips();
  }
  function markStripSelection() {
    var strips = root.querySelectorAll('[data-role-strip]');
    var i, j;
    for (i = 0; i < strips.length; i++) {
      var key = strips[i].getAttribute('data-role-strip');
      var current = null;
      if (key.indexOf('palette.') === 0) {
        var role = key.slice(8);
        current = (workingTheme.palette && workingTheme.palette[role]) || null;
      } else if (key.indexOf('theme:') === 0) {
        current = getPath(workingTheme, key.slice(6)) || null;
      } else {
        current = getPath(clientEffective(), key) || null;
      }
      var buttons = strips[i].querySelectorAll('.lg-role-swatch');
      for (j = 0; j < buttons.length; j++) {
        buttons[j].className = buttons[j].getAttribute('data-role-pick') === current ? 'lg-role-swatch selected' : 'lg-role-swatch';
      }
    }
  }
  function writeThemeValue(path, value) {
    if (value === null || value === '') {
      // delete the key — absent inherits from the base design (09 §9.2)
      var parts = path.split('.');
      var parent = parts.length > 1 ? getPath(workingTheme, parts.slice(0, -1).join('.')) : workingTheme;
      if (isRecordVal(parent)) { delete parent[parts[parts.length - 1]]; }
    } else {
      setPath(workingTheme, path, value);
      workingTheme.version = 1;
    }
    themeDirty = true;
    markDirty();
    paintSwatches();
    markStripSelection();
    schedulePreview();
    scheduleMiniPreview();
  }
  // ONE palette write path (role picks, harmony steps, Advanced custom
  // colors): §4.5-aware — rides frame_overrides_json.theme when the theme
  // override switch is ON for this arm, the funnel theme otherwise.
  function applyPaletteValue(role, value) {
    if (!isControl && overrideMode['theme'] === 'override') {
      if (!isRecordVal(workingOverrides.theme)) { workingOverrides.theme = {}; }
      if (!isRecordVal(workingOverrides.theme.palette)) { workingOverrides.theme.palette = {}; }
      workingOverrides.theme.palette[role] = value;
      overridesDirty = true;
      markDirty();
      paintSwatches();
      markStripSelection();
      updateOverrideBadge();
      schedulePreview();
      scheduleMiniPreview();
    } else {
      if (!isRecordVal(workingTheme.palette)) { workingTheme.palette = {}; }
      writeThemeValue('palette.' + role, value);
    }
  }
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var pick = el.getAttribute('data-role-pick');
    if (pick === null) { return; }
    var pickFor = el.getAttribute('data-role-pick-for') || '';
    if (pickFor.indexOf('palette.') === 0) {
      applyPaletteValue(pickFor.slice(8), pick);
      return;
    }
    if (pickFor.indexOf('theme:') === 0) { writeThemeValue(pickFor.slice(6), pick); return; }
    if (pickFor !== '') { writeConfigValue(pickFor, pick); markStripSelection(); }
  });
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var resetRole = el.getAttribute('data-role-reset');
    if (resetRole === null) { return; }
    if (workingOverrides.theme && workingOverrides.theme.palette && workingOverrides.theme.palette[resetRole] !== undefined) {
      delete workingOverrides.theme.palette[resetRole];
      overridesDirty = true;
      markDirty();
      paintSwatches(); markStripSelection(); updateOverrideBadge(); schedulePreview(); scheduleMiniPreview();
      return;
    }
    writeThemeValue('palette.' + resetRole, null);
  });
  root.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var key = el.getAttribute('data-theme-key');
    if (key === null) { return; }
    writeThemeValue(key, el.value === '' ? null : el.value);
  });
  // The 09 §9.3 Advanced custom-color path — the ONLY hex entry point. The
  // harmony DERIVED steps below route through this same function (populated
  // Advanced controls + this apply), so a custom value never silently skips
  // the warning semantics; the server re-warns on save (validateTheme).
  function applyAdvancedHex() {
    var roleSel = byId('lg-theme-hex-role');
    var valueEl = byId('lg-theme-hex-value');
    if (!roleSel || !valueEl) { return; }
    var v = (valueEl.value || '').trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(v)) {
      showMsg('lg-quote-error', 'Custom colors must be a color value like #1a2b3c.');
      return;
    }
    hideMsg('lg-quote-error');
    applyPaletteValue(roleSel.value, v);
  }
  (function () {
    var apply = byId('lg-theme-hex-apply');
    if (!apply) { return; }
    apply.addEventListener('click', applyAdvancedHex);
  }());

  // --- 09 §9.3 curated harmonies (DEV-60 d): base / wash / darker / lighter --
  // Derived in the island from the BASE design's role value (base_tokens from
  // the SSR blob) with simple channel-mix math; buttons carry LABELS, chips
  // are painted client-side (no hex text on the normal surface).
  var baseTokens = lgData.base_tokens || {};
  function hexToRgb(hex) {
    var h = String(hex || '').replace(/^#/, '');
    if (h.length === 3) { h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2); }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) { return null; }
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function channelHex(n) {
    var v = Math.max(0, Math.min(255, Math.round(n)));
    var s = v.toString(16);
    return s.length === 1 ? '0' + s : s;
  }
  function mixHex(hex, target, ratio) {
    var rgb = hexToRgb(hex);
    if (rgb === null) { return null; }
    return '#' + channelHex(rgb[0] * (1 - ratio) + target[0] * ratio) +
      channelHex(rgb[1] * (1 - ratio) + target[1] * ratio) +
      channelHex(rgb[2] * (1 - ratio) + target[2] * ratio);
  }
  function harmonyValue(role, step) {
    var base = baseTokens[role] || tokens[role] || '';
    if (step === 'base') { return base; }
    if (step === 'wash') { return mixHex(base, [255, 255, 255], 0.85); }
    if (step === 'darker') { return mixHex(base, [0, 0, 0], 0.25); }
    if (step === 'lighter') { return mixHex(base, [255, 255, 255], 0.3); }
    return null;
  }
  function paintHarmonyChips() {
    var steps = root.querySelectorAll('[data-harmony-step]');
    var i;
    for (i = 0; i < steps.length; i++) {
      var chip = steps[i].querySelector('[data-harmony-chip]');
      var hv = harmonyValue(steps[i].getAttribute('data-harmony-role'), steps[i].getAttribute('data-harmony-step'));
      if (chip && hv) { chip.style.background = hv; }
    }
  }
  root.addEventListener('click', function (ev) {
    var node = ev.target;
    while (node && node.getAttribute && node.getAttribute('data-harmony-step') === null) { node = node.parentNode; }
    if (!node || !node.getAttribute) { return; }
    var role = node.getAttribute('data-harmony-role');
    var step = node.getAttribute('data-harmony-step');
    if (step === 'base') {
      // the ROLE-VALUE alias — the server resolves it to the base design's
      // value (09 §9.2 alias rule), so the theme stays hex-free.
      applyPaletteValue(role, role);
      return;
    }
    var derived = harmonyValue(role, step);
    if (derived === null) {
      showMsg('lg-quote-error', 'This step cannot be derived \\u2014 the base value is not a simple color.');
      return;
    }
    // §9.3: a derived step is a CUSTOM color — surface + route it through the
    // Advanced token administration path (open panel, filled controls, same
    // apply), never a silent bypass of its warning semantics.
    var roleSel = byId('lg-theme-hex-role');
    var valueEl = byId('lg-theme-hex-value');
    var adv = byId('lg-theme-advanced');
    if (roleSel) { roleSel.value = role; }
    if (valueEl) { valueEl.value = derived; }
    if (adv) { adv.open = true; }
    applyAdvancedHex();
  });

  // --- populate every inspector control from the effective config ------------
  function populateAllControls() {
    var eff = clientEffective();
    var controls = root.querySelectorAll('[data-frame-key]');
    var i;
    for (i = 0; i < controls.length; i++) {
      var el = controls[i];
      var val = getPath(eff, el.getAttribute('data-frame-key'));
      if (el.type === 'checkbox') { el.checked = val === true; }
      else if (el.type === 'radio') { el.checked = String(val) === el.value; }
      else { el.value = val === null || val === undefined ? '' : String(val); }
    }
    var manual = root.querySelector('[data-manual-logo]');
    if (manual) { manual.checked = eff.header && eff.header.logo_source === 'manual'; }
    fillList('footer.links', eff.footer ? eff.footer.links : []);
    fillList('trust_strip.logos', eff.trust_strip ? eff.trust_strip.logos : []);
    fillList('benefit_bar.items', eff.benefit_bar ? eff.benefit_bar.items : []);
    // Round-4 P5b — the Templates-tab seven box pickers' dynamic lists.
    fillCtaSlots(eff.cta_slots || []);
    fillDisclosureEntries((eff.disclosure && eff.disclosure.entries) || []);
    fillFreeText(eff.free_text || []);
    fillBrandLogos(eff.brand_logos || null);
    fillFooterBlocks((eff.footer && eff.footer.blocks) || []);
    fillImages(eff.images || []);
    var themeControls = root.querySelectorAll('[data-theme-key]');
    for (i = 0; i < themeControls.length; i++) {
      var tval = getPath(workingTheme, themeControls[i].getAttribute('data-theme-key'));
      themeControls[i].value = tval === null || tval === undefined ? '' : String(tval);
    }
    syncAllMediaFields();
    paintSwatches();
    markStripSelection();
  }

  // ==========================================================================
  // Round-4 P5b — Templates-tab seven box pickers. Each dynamic list follows
  // the SAME <template> clone + querySelectorAll collect idiom the pre-
  // existing footer.links/trust_strip.logos/benefit_bar.items lists use
  // (renderFrameList/fillList/collectList above), generalized for richer row
  // shapes (selects, nested condition/block sub-lists) those flat helpers
  // can't express. A row is INCLUDED in its group's collected array only when
  // it carries real content (mirrors collectList's 'if (any)' guard) — an
  // added-then-abandoned blank row never reaches Save.
  // ==========================================================================

  function tplList(key) { return root.querySelector('[data-tplbox-list="' + key + '"]'); }
  function tplTemplate(key) { return root.querySelector('template[data-tplbox-tpl="' + key + '"]'); }
  function cloneTplRow(key) {
    var tpl = tplTemplate(key);
    if (!tpl || !tpl.content) { return null; }
    var frag = document.importNode(tpl.content, true);
    return frag.firstElementChild;
  }
  // Walk up from 'el' to the nearest ancestor carrying 'attr', or null.
  function closestAttr(el, attr) {
    var node = el;
    while (node && node.getAttribute) {
      if (node.getAttribute(attr) !== null) { return node; }
      node = node.parentNode;
    }
    return null;
  }
  function enclosingTplboxPanel(el) {
    var node = closestAttr(el, 'data-tplbox-panel');
    return node ? node.getAttribute('data-tplbox-panel') : null;
  }
  // Swap a row with its previous/next sibling (F brand-logo items, G footer
  // blocks "order (up/down)") — the same adjacent-swap idiom movePage/moveSlot
  // use elsewhere in this island, generalized to any row element.
  function moveRowSibling(row, dir) {
    if (!row || !row.parentNode) { return; }
    if (dir < 0) {
      var prev = row.previousElementSibling;
      if (prev) { row.parentNode.insertBefore(row, prev); }
    } else {
      var next = row.nextElementSibling;
      if (next) { row.parentNode.insertBefore(next, row); }
    }
  }
  // A minimal bold/italic/link toolbar over a <textarea>'s current selection
  // (E free-text blocks) — wraps with the SAME inline tags frame.ts's
  // sanitizeHtml allow-list accepts (strong/em/a), written into the block's
  // 'html' field. No rich-text editor dependency; plain selectionStart/End.
  function wrapSelection(ta, fmt) {
    var start = ta.selectionStart || 0;
    var end = ta.selectionEnd || 0;
    var value = ta.value || '';
    var selected = value.slice(start, end);
    var openTag = '';
    var closeTag = '';
    if (fmt === 'bold') { openTag = '<strong>'; closeTag = '</strong>'; }
    else if (fmt === 'italic') { openTag = '<em>'; closeTag = '</em>'; }
    else if (fmt === 'link') {
      var url = window.prompt('Link address (https://…)', 'https://');
      if (!url) { return; }
      openTag = '<a href="' + url.replace(/"/g, '&quot;') + '">';
      closeTag = '</a>';
    } else { return; }
    ta.value = value.slice(0, start) + openTag + selected + closeTag + value.slice(end);
    ta.focus();
    var pos = start + openTag.length + selected.length + closeTag.length;
    if (ta.setSelectionRange) { ta.setSelectionRange(pos, pos); }
  }
  // Shared page-targeting mini-control (10E/10F) — 'all' (the default) is
  // OMITTED entirely (both 'pages' fields are optional), keeping a
  // byte-minimal patch when the operator never restricts pages.
  function collectPageTarget(scopeEl) {
    var modeEl = scopeEl.querySelector('[data-pt-mode]');
    var mode = modeEl ? modeEl.value : 'all';
    if (!mode || mode === 'all') { return null; }
    var pt = { mode: mode };
    if (mode === 'range') {
      var fromEl = scopeEl.querySelector('[data-pt-from]');
      var toEl = scopeEl.querySelector('[data-pt-to]');
      pt.from = fromEl && fromEl.value !== '' ? Number(fromEl.value) : 1;
      pt.to = toEl && toEl.value !== '' ? Number(toEl.value) : pt.from;
    } else if (mode === 'list') {
      var listEl = scopeEl.querySelector('[data-pt-list]');
      var raw = listEl ? listEl.value : '';
      var parts = raw.split(',');
      var pages = [];
      var i;
      for (i = 0; i < parts.length; i++) {
        var n = Number(parts[i].replace(/^\\s+|\\s+$/g, ''));
        if (parts[i].replace(/^\\s+|\\s+$/g, '') !== '' && isFinite(n)) { pages.push(n); }
      }
      pt.pages = pages;
    }
    return pt;
  }
  function fillPageTarget(scopeEl, pt) {
    var modeEl = scopeEl.querySelector('[data-pt-mode]');
    if (!modeEl) { return; }
    setListFieldValue(modeEl, (pt && pt.mode) || 'all');
    var fromEl = scopeEl.querySelector('[data-pt-from]');
    var toEl = scopeEl.querySelector('[data-pt-to]');
    var listEl = scopeEl.querySelector('[data-pt-list]');
    if (fromEl) { fromEl.value = pt && pt.from !== undefined ? String(pt.from) : ''; }
    if (toEl) { toEl.value = pt && pt.to !== undefined ? String(pt.to) : ''; }
    if (listEl) { listEl.value = pt && Object.prototype.toString.call(pt.pages) === '[object Array]' ? pt.pages.join(', ') : ''; }
  }

  // --- C: cta_slots — top-level array; 'when'/'op'/'value' mirror the
  // FrameCtaCondition grammar exactly (frames.ts validateFrameCondition). ----
  function ctaConditionRowValues(row) {
    return {
      when: row.querySelector('[data-cta-cond-field]').value,
      op: row.querySelector('[data-cta-cond-op]').value,
      value: row.querySelector('[data-cta-cond-value]').value
    };
  }
  function addCtaConditionRow(ctaRow, values) {
    var rowsBox = ctaRow.querySelector('[data-cta-cond-rows]');
    var row = cloneTplRow('cta_cond_row');
    if (!rowsBox || !row) { return; }
    if (values) {
      var fEl = row.querySelector('[data-cta-cond-field]');
      var oEl = row.querySelector('[data-cta-cond-op]');
      var vEl = row.querySelector('[data-cta-cond-value]');
      if (fEl && values.when !== undefined) { setListFieldValue(fEl, String(values.when)); }
      if (oEl && values.op !== undefined) { setListFieldValue(oEl, String(values.op)); }
      if (vEl && values.value !== undefined && values.value !== null) { vEl.value = String(values.value); }
    }
    rowsBox.appendChild(row);
  }
  function openCtaCondition(ctaRow) {
    var box = ctaRow.querySelector('[data-cta-cond-box]');
    var toggle = ctaRow.querySelector('[data-cta-cond-toggle]');
    if (box) { box.className = 'lg-tplbox-cond'; }
    if (toggle) { toggle.setAttribute('aria-expanded', 'true'); }
  }
  function collectCtaCondition(ctaRow) {
    var box = ctaRow.querySelector('[data-cta-cond-box]');
    if (!box || String(box.className).indexOf('lg-hidden') >= 0) { return null; }
    var condRows = box.querySelectorAll('[data-cta-cond-row]');
    var conds = [];
    var i;
    for (i = 0; i < condRows.length; i++) {
      var v = ctaConditionRowValues(condRows[i]);
      if (v.when === '' && v.value === '') { continue; }
      conds.push({ when: v.when, op: v.op, value: v.value });
    }
    if (conds.length === 0) { return null; }
    if (conds.length === 1) { return conds[0]; }
    var matchSel = box.querySelector('[data-cta-cond-match]');
    return { match: matchSel ? matchSel.value : 'all', conditions: conds };
  }
  function collectCtaSlots() {
    var list = tplList('cta_slots');
    if (!list) { return []; }
    var rows = list.querySelectorAll('[data-cta-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var tel = r.querySelector('[data-cta-tel]').value;
      var href = r.querySelector('[data-cta-href]').value;
      if (tel === '' && href === '') { continue; } // frame.ts ctaHref -> null either way — nothing to persist
      var entry = {
        slot: r.querySelector('[data-cta-slot]').value,
        label: r.querySelector('[data-cta-label]').value,
        align: r.querySelector('[data-cta-align]').value
      };
      if (tel !== '') { entry.tel = tel; }
      if (href !== '') { entry.href = href; }
      var cond = collectCtaCondition(r);
      if (cond) { entry.condition = cond; }
      out.push(entry);
    }
    return out;
  }
  function fillCtaSlots(items) {
    var list = tplList('cta_slots');
    if (!list) { return; }
    clearChildren(list);
    var i;
    for (i = 0; i < items.length; i++) {
      var row = cloneTplRow('cta_slots');
      if (!row) { continue; }
      var it = items[i] || {};
      setListFieldValue(row.querySelector('[data-cta-slot]'), it.slot || 'header_right');
      var labelEl = row.querySelector('[data-cta-label]'); if (labelEl) { labelEl.value = it.label || ''; }
      var telEl = row.querySelector('[data-cta-tel]'); if (telEl) { telEl.value = it.tel || ''; }
      var hrefEl = row.querySelector('[data-cta-href]'); if (hrefEl) { hrefEl.value = it.href || ''; }
      setListFieldValue(row.querySelector('[data-cta-align]'), it.align || 'left');
      if (it.condition) {
        openCtaCondition(row);
        if (it.condition.conditions) {
          var matchSel = row.querySelector('[data-cta-cond-match]');
          if (matchSel) { setListFieldValue(matchSel, it.condition.match || 'all'); }
          var c;
          for (c = 0; c < it.condition.conditions.length; c++) { addCtaConditionRow(row, it.condition.conditions[c]); }
        } else {
          addCtaConditionRow(row, it.condition);
        }
      }
      list.appendChild(row);
    }
  }

  // --- D: disclosure.entries — nested under the existing 'disclosure' group. -
  function collectDisclosureEntries() {
    var list = tplList('disclosure.entries');
    if (!list) { return []; }
    var rows = list.querySelectorAll('[data-disc-entry-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var text = r.querySelector('[data-disc-text]').value;
      var linkLabel = r.querySelector('[data-disc-link-label]').value;
      if (text === '' && linkLabel === '') { continue; }
      var entry = {
        location: r.querySelector('[data-disc-location]').value,
        mode: r.querySelector('[data-disc-mode]').value,
        text: text,
        align: r.querySelector('[data-disc-align]').value
      };
      if (linkLabel !== '') { entry.link_label = linkLabel; }
      out.push(entry);
    }
    return out;
  }
  function fillDisclosureEntries(entries) {
    var list = tplList('disclosure.entries');
    if (!list) { return; }
    clearChildren(list);
    var i;
    for (i = 0; i < entries.length; i++) {
      var row = cloneTplRow('disclosure.entries');
      if (!row) { continue; }
      var e = entries[i] || {};
      setListFieldValue(row.querySelector('[data-disc-location]'), e.location || 'bottom');
      setListFieldValue(row.querySelector('[data-disc-mode]'), e.mode || 'full');
      var llEl = row.querySelector('[data-disc-link-label]'); if (llEl) { llEl.value = e.link_label || ''; }
      setListFieldValue(row.querySelector('[data-disc-align]'), e.align || 'left');
      var textEl = row.querySelector('[data-disc-text]'); if (textEl) { textEl.value = e.text || ''; }
      list.appendChild(row);
    }
  }

  // --- E: free_text — top-level array; each entry owns a 'blocks' sub-list. -
  function ftGenId() { return 'ft_' + Date.now() + '_' + Math.floor(Math.random() * 100000); }
  function ftBlockTypeChanged(blockRow) {
    var type = blockRow.querySelector('[data-ft-block-type]').value;
    var itemsEl = blockRow.querySelector('[data-ft-block-items]');
    var textEl = blockRow.querySelector('[data-ft-block-text]');
    var styleEl = blockRow.querySelector('[data-ft-block-liststyle]');
    var toolbar = blockRow.querySelector('[data-ft-block-toolbar]');
    var isList = type === 'list';
    if (itemsEl) { itemsEl.className = isList ? 'form-input' : 'form-input lg-hidden'; }
    if (textEl) { textEl.className = isList ? 'form-input lg-hidden' : 'form-input'; }
    if (styleEl) { styleEl.className = isList ? 'form-select form-select-sm' : 'form-select form-select-sm lg-hidden'; }
    if (toolbar) { toolbar.className = isList ? 'lg-tplbox-toolbar lg-hidden' : 'lg-tplbox-toolbar'; }
  }
  function addFreeTextBlockRow(entryRow, values) {
    var box = entryRow.querySelector('[data-ft-blocks]');
    var row = cloneTplRow('free_text_block');
    if (!box || !row) { return; }
    if (values) {
      setListFieldValue(row.querySelector('[data-ft-block-type]'), values.type || 'paragraph');
      if (values.type === 'list') {
        var itemsEl = row.querySelector('[data-ft-block-items]');
        if (itemsEl) { itemsEl.value = Object.prototype.toString.call(values.items) === '[object Array]' ? values.items.join('\\n') : ''; }
        setListFieldValue(row.querySelector('[data-ft-block-liststyle]'), values.style || 'unordered');
      } else {
        var textEl = row.querySelector('[data-ft-block-text]');
        if (textEl) { textEl.value = values.html || values.text || ''; }
      }
    }
    box.appendChild(row);
    ftBlockTypeChanged(row);
  }
  function ftBlockValues(blockRow) {
    var type = blockRow.querySelector('[data-ft-block-type]').value;
    if (type === 'list') {
      var itemsRaw = blockRow.querySelector('[data-ft-block-items]').value;
      var lines = itemsRaw.split('\\n');
      var items = [];
      var i;
      for (i = 0; i < lines.length; i++) {
        var t = lines[i].replace(/^\\s+|\\s+$/g, '');
        if (t !== '') { items.push(t); }
      }
      if (items.length === 0) { return null; }
      var styleEl = blockRow.querySelector('[data-ft-block-liststyle]');
      return { type: 'list', items: items, style: styleEl ? styleEl.value : 'unordered' };
    }
    var text = blockRow.querySelector('[data-ft-block-text]').value;
    if (text === '') { return null; }
    return { type: type, html: text };
  }
  function collectFreeTextBlocks(entryRow) {
    var box = entryRow.querySelector('[data-ft-blocks]');
    if (!box) { return []; }
    var rows = box.querySelectorAll('[data-ft-block-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var b = ftBlockValues(rows[i]);
      if (b) { out.push(b); }
    }
    return out;
  }
  function collectFreeText() {
    var list = tplList('free_text');
    if (!list) { return []; }
    var rows = list.querySelectorAll('[data-ft-entry-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var blocks = collectFreeTextBlocks(r);
      if (blocks.length === 0) { continue; }
      var idEl = r.querySelector('[data-ft-entry-id]');
      if (idEl && !idEl.value) { idEl.value = ftGenId(); }
      var entry = {
        id: idEl ? idEl.value : ftGenId(),
        slot: r.querySelector('[data-ft-slot]').value,
        blocks: blocks,
        align: r.querySelector('[data-ft-align]').value
      };
      var sizeEl = r.querySelector('[data-ft-typo-size]');
      var colorEl = r.querySelector('[data-ft-typo-color]');
      var typo = {};
      var hasTypo = false;
      if (sizeEl && sizeEl.value !== '') { typo.size = sizeEl.value; hasTypo = true; }
      if (colorEl && colorEl.value !== '') { typo.color = colorEl.value; hasTypo = true; }
      if (hasTypo) { entry.typography = typo; }
      var pt = collectPageTarget(r);
      if (pt) { entry.pages = pt; }
      out.push(entry);
    }
    return out;
  }
  function fillFreeText(entries) {
    var list = tplList('free_text');
    if (!list) { return; }
    clearChildren(list);
    var i;
    for (i = 0; i < entries.length; i++) {
      var row = cloneTplRow('free_text');
      if (!row) { continue; }
      var e = entries[i] || {};
      var idEl = row.querySelector('[data-ft-entry-id]'); if (idEl) { idEl.value = e.id || ftGenId(); }
      setListFieldValue(row.querySelector('[data-ft-slot]'), e.slot || 'above_section');
      setListFieldValue(row.querySelector('[data-ft-align]'), e.align || 'left');
      var sizeEl = row.querySelector('[data-ft-typo-size]');
      var colorEl = row.querySelector('[data-ft-typo-color]');
      if (sizeEl) { sizeEl.value = (e.typography && e.typography.size) || ''; }
      if (colorEl) { colorEl.value = (e.typography && e.typography.color) || ''; }
      fillPageTarget(row, e.pages);
      var blocks = Object.prototype.toString.call(e.blocks) === '[object Array]' ? e.blocks : [];
      var b;
      for (b = 0; b < blocks.length; b++) { addFreeTextBlockRow(row, blocks[b]); }
      list.appendChild(row);
    }
  }

  // --- F: brand_logos — one wrapper object + an 'items' sub-list. -----------
  function collectBrandLogoItems() {
    var list = tplList('brand_logos.items');
    if (!list) { return []; }
    var rows = list.querySelectorAll('[data-bl-item-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var mediaInput = r.querySelector('[data-list-field="media_id"]');
      var mediaId = mediaInput ? mediaInput.value : '';
      var url = r.querySelector('[data-bl-item-url]').value;
      var alt = r.querySelector('[data-bl-item-alt]').value;
      if (mediaId === '' && url === '' && alt === '') { continue; }
      var item = { alt: alt };
      if (mediaId !== '') { item.media_id = mediaId; }
      if (url !== '') { item.url = url; }
      var sizeEl = r.querySelector('[data-bl-item-size]');
      item.size = sizeEl ? sizeEl.value : 'm';
      out.push(item);
    }
    return out;
  }
  function collectBrandLogos() {
    var panel = root.querySelector('[data-tplbox-panel="brand_logos"]');
    if (!panel) { return { enabled: false, items: [], layout: 'row' }; }
    var enabledEl = panel.querySelector('[data-bl-enabled]');
    var layoutEl = panel.querySelector('[data-bl-layout]');
    var slotEl = panel.querySelector('[data-bl-slot]');
    var alignEl = panel.querySelector('[data-bl-align]');
    var cfg = {
      enabled: enabledEl ? enabledEl.checked : false,
      layout: layoutEl ? layoutEl.value : 'row',
      items: collectBrandLogoItems(),
      slot: slotEl ? slotEl.value : 'below_section',
      align: alignEl ? alignEl.value : 'left'
    };
    var pt = collectPageTarget(panel);
    if (pt) { cfg.pages = pt; }
    return cfg;
  }
  function fillBrandLogoItemRow(row, it) {
    var mediaInput = row.querySelector('[data-list-field="media_id"]');
    if (mediaInput) { mediaInput.value = it.media_id || ''; }
    var span = row.querySelector('[data-media-field]');
    if (span) { syncMediaField(span); }
    var urlEl = row.querySelector('[data-bl-item-url]'); if (urlEl) { urlEl.value = it.url || ''; }
    var altEl = row.querySelector('[data-bl-item-alt]'); if (altEl) { altEl.value = it.alt || ''; }
    setListFieldValue(row.querySelector('[data-bl-item-size]'), it.size || 'm');
  }
  function fillBrandLogos(cfg) {
    var panel = root.querySelector('[data-tplbox-panel="brand_logos"]');
    if (!panel) { return; }
    var enabledEl = panel.querySelector('[data-bl-enabled]');
    if (enabledEl) { enabledEl.checked = !!(cfg && cfg.enabled); }
    setListFieldValue(panel.querySelector('[data-bl-layout]'), (cfg && cfg.layout) || 'row');
    setListFieldValue(panel.querySelector('[data-bl-slot]'), (cfg && cfg.slot) || 'below_section');
    setListFieldValue(panel.querySelector('[data-bl-align]'), (cfg && cfg.align) || 'left');
    fillPageTarget(panel, cfg ? cfg.pages : undefined);
    var list = tplList('brand_logos.items');
    if (list) {
      clearChildren(list);
      var items = (cfg && cfg.items) || [];
      var i;
      for (i = 0; i < items.length; i++) {
        var row = cloneTplRow('brand_logos.items');
        if (!row) { continue; }
        fillBrandLogoItemRow(row, items[i] || {});
        list.appendChild(row);
      }
    }
  }

  // --- G: footer.blocks — nested under the existing 'footer' group. ---------
  function footerBlockTypeChanged(blockRow) {
    var type = blockRow.querySelector('[data-footer-block-type]').value;
    var textEl = blockRow.querySelector('[data-footer-block-text]');
    var linkrowEl = blockRow.querySelector('[data-footer-block-linkrow]');
    var showText = type === 'about_paragraph' || type === 'disclosure' || type === 'address';
    var showLinks = type === 'link_row';
    if (textEl) { textEl.className = showText ? 'form-input' : 'form-input lg-hidden'; }
    if (linkrowEl) { linkrowEl.className = showLinks ? '' : 'lg-hidden'; }
  }
  function addFooterLinkRow(linkrowEl, values) {
    var box = linkrowEl.querySelector('[data-footer-block-links]');
    var row = cloneTplRow('footer_link_row');
    if (!box || !row) { return; }
    if (values) {
      var labelEl = row.querySelector('[data-footer-link-label]'); if (labelEl) { labelEl.value = values.label || ''; }
      var hrefEl = row.querySelector('[data-footer-link-href]'); if (hrefEl) { hrefEl.value = values.href || ''; }
    }
    box.appendChild(row);
  }
  function collectFooterLinkRows(linkrowEl) {
    var box = linkrowEl.querySelector('[data-footer-block-links]');
    if (!box) { return []; }
    var rows = box.querySelectorAll('[data-footer-link-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var label = rows[i].querySelector('[data-footer-link-label]').value;
      var href = rows[i].querySelector('[data-footer-link-href]').value;
      if (label === '' && href === '') { continue; }
      out.push({ label: label, href: href });
    }
    return out;
  }
  function collectFooterBlocks() {
    var list = tplList('footer.blocks');
    if (!list) { return []; }
    var rows = list.querySelectorAll('[data-footer-block-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var type = r.querySelector('[data-footer-block-type]').value;
      var text = r.querySelector('[data-footer-block-text]').value;
      var align = r.querySelector('[data-footer-block-align]').value;
      var showText = type === 'about_paragraph' || type === 'disclosure' || type === 'address';
      if (showText && text === '') { continue; } // an empty text-typed block renders nothing — skip it
      var block = { type: type, align: align };
      if (showText) { block.text = text; }
      if (type === 'link_row') {
        var linkrowEl = r.querySelector('[data-footer-block-linkrow]');
        var linksSourceEl = r.querySelector('[data-footer-block-linksource]');
        block.links_source = linksSourceEl ? linksSourceEl.value : 'site';
        if (block.links_source === 'manual') {
          var links = linkrowEl ? collectFooterLinkRows(linkrowEl) : [];
          if (links.length === 0) { continue; } // nothing typed — a manual link row would render nothing
          block.links = links;
        }
      }
      out.push(block);
    }
    return out;
  }
  function fillFooterBlocks(blocks) {
    var list = tplList('footer.blocks');
    if (!list) { return; }
    clearChildren(list);
    var i;
    for (i = 0; i < blocks.length; i++) {
      var row = cloneTplRow('footer.blocks');
      if (!row) { continue; }
      var b = blocks[i] || {};
      setListFieldValue(row.querySelector('[data-footer-block-type]'), b.type || 'about_paragraph');
      setListFieldValue(row.querySelector('[data-footer-block-align]'), b.align || 'left');
      var textEl = row.querySelector('[data-footer-block-text]'); if (textEl) { textEl.value = b.text || ''; }
      if (b.type === 'link_row') {
        var linkrowEl = row.querySelector('[data-footer-block-linkrow]');
        var linksSourceEl = row.querySelector('[data-footer-block-linksource]');
        setListFieldValue(linksSourceEl, b.links_source || 'site');
        var links = Object.prototype.toString.call(b.links) === '[object Array]' ? b.links : [];
        var l;
        for (l = 0; l < links.length; l++) { addFooterLinkRow(linkrowEl, links[l]); }
      }
      list.appendChild(row);
      footerBlockTypeChanged(row);
    }
  }

  // --- H: images — top-level array; EACH item owns its own slot/pages -------
  // (mirrors free_text, not brand_logos' single group slot). The id field is
  // REQUIRED (validateImages) and never operator-authored — stamped at
  // collect time, same idiom as ftGenId.
  function imgGenId() { return 'img_' + Date.now() + '_' + Math.floor(Math.random() * 100000); }
  function collectImages() {
    var list = tplList('images');
    if (!list) { return []; }
    var rows = list.querySelectorAll('[data-img-item-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var mediaInput = r.querySelector('[data-list-field="media_id"]');
      var mediaId = mediaInput ? mediaInput.value : '';
      var url = r.querySelector('[data-img-item-url]').value;
      var alt = r.querySelector('[data-img-item-alt]').value;
      if (mediaId === '' && url === '' && alt === '') { continue; }
      var idEl = r.querySelector('[data-img-item-id]');
      if (idEl && !idEl.value) { idEl.value = imgGenId(); }
      var item = {
        id: idEl ? idEl.value : imgGenId(),
        alt: alt,
        slot: r.querySelector('[data-img-item-slot]').value
      };
      if (mediaId !== '') { item.media_id = mediaId; }
      if (url !== '') { item.url = url; }
      var sizeEl = r.querySelector('[data-img-item-size]');
      item.size = sizeEl ? sizeEl.value : 'm';
      var alignEl = r.querySelector('[data-img-item-align]');
      item.align = alignEl ? alignEl.value : 'left';
      var tooltipEl = r.querySelector('[data-img-item-tooltip]');
      if (tooltipEl && tooltipEl.value !== '') { item.tooltip = tooltipEl.value; }
      var pt = collectPageTarget(r);
      if (pt) { item.pages = pt; }
      out.push(item);
    }
    return out;
  }
  function fillImageItemRow(row, it) {
    var idEl = row.querySelector('[data-img-item-id]'); if (idEl) { idEl.value = it.id || imgGenId(); }
    var mediaInput = row.querySelector('[data-list-field="media_id"]');
    if (mediaInput) { mediaInput.value = it.media_id || ''; }
    var span = row.querySelector('[data-media-field]');
    if (span) { syncMediaField(span); }
    var urlEl = row.querySelector('[data-img-item-url]'); if (urlEl) { urlEl.value = it.url || ''; }
    var altEl = row.querySelector('[data-img-item-alt]'); if (altEl) { altEl.value = it.alt || ''; }
    setListFieldValue(row.querySelector('[data-img-item-slot]'), it.slot || 'above_section');
    setListFieldValue(row.querySelector('[data-img-item-size]'), it.size || 'm');
    setListFieldValue(row.querySelector('[data-img-item-align]'), it.align || 'left');
    var tooltipEl = row.querySelector('[data-img-item-tooltip]'); if (tooltipEl) { tooltipEl.value = it.tooltip || ''; }
    fillPageTarget(row, it.pages);
  }
  function fillImages(items) {
    var list = tplList('images');
    if (!list) { return; }
    clearChildren(list);
    var i;
    for (i = 0; i < items.length; i++) {
      var row = cloneTplRow('images');
      if (!row) { continue; }
      fillImageItemRow(row, items[i] || {});
      list.appendChild(row);
    }
  }
  // A single-line inline note (upload/persona-generation errors) — shown when
  // the message is truthy, hidden otherwise. Reused by both P5c asset flows.
  function showInlineNote(el, message) {
    if (!el) { return; }
    if (message) { el.textContent = message; el.className = 'form-help'; }
    else { el.className = 'form-help lg-hidden'; }
  }

  // A media pick (the shared #lg-media-picker modal) sets a hidden input
  // directly (no native 'change' event) — writeMediaFieldValue's fallback
  // (below, near the media-picker section) recognizes a 'data-tplbox-list'
  // ancestor and calls this SAME dispatcher so a picked brand-logo image
  // persists exactly like every other tplbox edit.
  var TPLBOX_LIST_WRITERS = {
    'cta_slots': function () { writeConfigValue('cta_slots', collectCtaSlots()); },
    'disclosure.entries': function () { writeConfigValue('disclosure.entries', collectDisclosureEntries()); },
    'free_text': function () { writeConfigValue('free_text', collectFreeText()); },
    'brand_logos.items': function () { writeConfigValue('brand_logos', collectBrandLogos()); },
    'footer.blocks': function () { writeConfigValue('footer.blocks', collectFooterBlocks()); },
    'images': function () { writeConfigValue('images', collectImages()); }
  };
  function writeTplboxList(key) {
    var writer = TPLBOX_LIST_WRITERS[key];
    if (writer) { writer(); }
  }
  var TPLBOX_PANEL_LIST_KEY = { cta: 'cta_slots', disclosure: 'disclosure.entries', free_text: 'free_text', brand_logos: 'brand_logos.items', footer: 'footer.blocks', images: 'images' };

  // ONE 'change' dispatcher for every box C–G field (selects/inputs/
  // textareas) — determines the owning box from the nearest
  // [data-tplbox-panel] ancestor and recollects+writes THAT group only.
  // Boxes A/B (background/logo) use the pre-existing generic [data-frame-key]
  // change listener instead (no entry here — TPLBOX_PANEL_LIST_KEY omits
  // them on purpose).
  root.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var panel = enclosingTplboxPanel(el);
    if (panel === null) { return; }
    var listKey = TPLBOX_PANEL_LIST_KEY[panel];
    if (listKey === undefined) { return; }
    if (panel === 'free_text' && el.getAttribute('data-ft-block-type') !== null) {
      var ftBlockRow = closestAttr(el, 'data-ft-block-row');
      if (ftBlockRow) { ftBlockTypeChanged(ftBlockRow); }
    }
    if (panel === 'footer' && el.getAttribute('data-footer-block-type') !== null) {
      var footerBlockRow = closestAttr(el, 'data-footer-block-row');
      if (footerBlockRow) { footerBlockTypeChanged(footerBlockRow); }
    }
    writeTplboxList(listKey);
  });

  // Box-card picker → its right-side editor (independent of the canvas's
  // data-region-panel/showRegionPanel — see the section header doc comment).
  function showTplBoxPanel(name) {
    var panels = root.querySelectorAll('[data-tplbox-panel]');
    var i;
    for (i = 0; i < panels.length; i++) {
      panels[i].className = panels[i].getAttribute('data-tplbox-panel') === name ? 'lg-inspector-panel lg-panel-card active' : 'lg-inspector-panel lg-panel-card';
    }
    var cards = root.querySelectorAll('[data-tplbox-pick]');
    for (i = 0; i < cards.length; i++) {
      cards[i].className = cards[i].getAttribute('data-tplbox-pick') === name ? 'lg-tplbox-card selected' : 'lg-tplbox-card';
    }
    var hint = byId('lg-tplbox-hint');
    if (hint) { hint.hidden = true; }
  }
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el.getAttribute && el.getAttribute('data-tplbox-pick') === null) { el = el.parentNode; }
    if (!el || !el.getAttribute) { return; }
    var name = el.getAttribute('data-tplbox-pick');
    if (name) { showTplBoxPanel(name); }
  });

  // "+ Add …" — one dispatcher for every box's add button (data-tplbox-add).
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var addKey = el.getAttribute('data-tplbox-add');
    if (addKey === null) { return; }
    var list = tplList(addKey);
    if (!list) { return; }
    if (addKey === 'free_text') {
      var row = cloneTplRow('free_text');
      if (row) { addFreeTextBlockRow(row, { type: 'paragraph' }); list.appendChild(row); }
      return;
    }
    if (addKey === 'footer.blocks') {
      var frow = cloneTplRow('footer.blocks');
      if (frow) { list.appendChild(frow); footerBlockTypeChanged(frow); }
      return;
    }
    var plain = cloneTplRow(addKey);
    if (plain) { list.appendChild(plain); }
  });

  // C: CTA slot row remove + the condition sub-editor (toggle/add/remove).
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.hasAttribute) { return; }
    if (el.hasAttribute('data-cta-remove')) {
      var row = closestAttr(el, 'data-cta-row');
      if (row && row.parentNode) { row.parentNode.removeChild(row); writeConfigValue('cta_slots', collectCtaSlots()); }
      return;
    }
    if (el.hasAttribute('data-cta-cond-toggle')) {
      var ctaRow = closestAttr(el, 'data-cta-row');
      if (!ctaRow) { return; }
      var box = ctaRow.querySelector('[data-cta-cond-box]');
      if (!box) { return; }
      var open = String(box.className).indexOf('lg-hidden') >= 0;
      box.className = open ? 'lg-tplbox-cond' : 'lg-tplbox-cond lg-hidden';
      el.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && box.querySelectorAll('[data-cta-cond-row]').length === 0) { addCtaConditionRow(ctaRow, null); }
      return;
    }
    if (el.hasAttribute('data-cta-cond-add')) {
      var ctaRow2 = closestAttr(el, 'data-cta-row');
      if (ctaRow2) { addCtaConditionRow(ctaRow2, null); }
      return;
    }
    if (el.hasAttribute('data-cta-cond-row-remove')) {
      var condRow = closestAttr(el, 'data-cta-cond-row');
      if (condRow && condRow.parentNode) { condRow.parentNode.removeChild(condRow); writeConfigValue('cta_slots', collectCtaSlots()); }
    }
  });

  // D: disclosure entry remove.
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.hasAttribute || !el.hasAttribute('data-disc-entry-remove')) { return; }
    var row = closestAttr(el, 'data-disc-entry-row');
    if (row && row.parentNode) { row.parentNode.removeChild(row); writeConfigValue('disclosure.entries', collectDisclosureEntries()); }
  });

  // E: free-text entry/block remove + "add a text block" + the toolbar.
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.hasAttribute) { return; }
    if (el.hasAttribute('data-ft-entry-remove')) {
      var eRow = closestAttr(el, 'data-ft-entry-row');
      if (eRow && eRow.parentNode) { eRow.parentNode.removeChild(eRow); writeConfigValue('free_text', collectFreeText()); }
      return;
    }
    if (el.hasAttribute('data-ft-block-add')) {
      var entryRow = closestAttr(el, 'data-ft-entry-row');
      if (entryRow) { addFreeTextBlockRow(entryRow, { type: 'paragraph' }); }
      return;
    }
    if (el.hasAttribute('data-ft-block-remove')) {
      var blockRow = closestAttr(el, 'data-ft-block-row');
      var owner = blockRow ? closestAttr(blockRow.parentNode, 'data-ft-entry-row') : null;
      if (blockRow && blockRow.parentNode) { blockRow.parentNode.removeChild(blockRow); }
      if (owner) { writeConfigValue('free_text', collectFreeText()); }
      return;
    }
    var fmt = el.getAttribute('data-ft-fmt');
    if (fmt) {
      var toolbarBlock = closestAttr(el, 'data-ft-block-row');
      var ta = toolbarBlock ? toolbarBlock.querySelector('[data-ft-block-text]') : null;
      if (ta) { wrapSelection(ta, fmt); writeConfigValue('free_text', collectFreeText()); }
    }
  });

  // F: brand-logo item remove/reorder.
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.hasAttribute) { return; }
    var itemRow = closestAttr(el, 'data-bl-item-row');
    if (!itemRow) { return; }
    if (el.hasAttribute('data-bl-item-remove')) { if (itemRow.parentNode) { itemRow.parentNode.removeChild(itemRow); } writeConfigValue('brand_logos', collectBrandLogos()); return; }
    if (el.hasAttribute('data-bl-item-up')) { moveRowSibling(itemRow, -1); writeConfigValue('brand_logos', collectBrandLogos()); return; }
    if (el.hasAttribute('data-bl-item-down')) { moveRowSibling(itemRow, 1); writeConfigValue('brand_logos', collectBrandLogos()); }
  });

  // G: footer block remove/reorder + its manual link-row sub-list.
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.hasAttribute) { return; }
    if (el.hasAttribute('data-footer-link-remove')) {
      var linkRow = closestAttr(el, 'data-footer-link-row');
      if (linkRow && linkRow.parentNode) { linkRow.parentNode.removeChild(linkRow); writeConfigValue('footer.blocks', collectFooterBlocks()); }
      return;
    }
    var blockRow = closestAttr(el, 'data-footer-block-row');
    if (!blockRow) { return; }
    if (el.hasAttribute('data-footer-block-remove')) { if (blockRow.parentNode) { blockRow.parentNode.removeChild(blockRow); } writeConfigValue('footer.blocks', collectFooterBlocks()); return; }
    if (el.hasAttribute('data-footer-block-up')) { moveRowSibling(blockRow, -1); writeConfigValue('footer.blocks', collectFooterBlocks()); return; }
    if (el.hasAttribute('data-footer-block-down')) { moveRowSibling(blockRow, 1); writeConfigValue('footer.blocks', collectFooterBlocks()); return; }
    if (el.hasAttribute('data-footer-block-link-add')) {
      var linkrowEl = blockRow.querySelector('[data-footer-block-linkrow]');
      if (linkrowEl) { addFooterLinkRow(linkrowEl, null); }
    }
  });

  // H: image item remove/reorder + the AI persona-portrait generator (P5c
  // POST /assets/persona-image, quota-guarded — checked server-side BEFORE
  // any OpenAI spend). Client-side guards (empty persona / no preview site
  // selected) short-circuit BEFORE the network call so an accidental click
  // never risks a spend; siteId is the SAME variable the canvas toolbar's
  // site selector already tracks (empty string = the CMS-fallback default,
  // i.e. no real site chosen yet).
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || !el.hasAttribute) { return; }
    var itemRow = closestAttr(el, 'data-img-item-row');
    if (!itemRow) { return; }
    if (el.hasAttribute('data-img-item-remove')) { if (itemRow.parentNode) { itemRow.parentNode.removeChild(itemRow); } writeConfigValue('images', collectImages()); return; }
    if (el.hasAttribute('data-img-item-up')) { moveRowSibling(itemRow, -1); writeConfigValue('images', collectImages()); return; }
    if (el.hasAttribute('data-img-item-down')) { moveRowSibling(itemRow, 1); writeConfigValue('images', collectImages()); return; }
    if (!el.hasAttribute('data-img-item-generate')) { return; }
    var personaEl = itemRow.querySelector('[data-img-item-persona]');
    var errEl = itemRow.querySelector('[data-img-item-gen-error]');
    var personaKey = personaEl ? personaEl.value : '';
    if (personaKey === '') { showInlineNote(errEl, 'Choose a persona first.'); return; }
    if (!siteId) { showInlineNote(errEl, 'Choose a preview site (canvas toolbar, above) to generate a persona image.'); return; }
    showInlineNote(errEl, null);
    el.disabled = true;
    var altEl = itemRow.querySelector('[data-img-item-alt]');
    var altVal = altEl ? altEl.value : '';
    fetch('/api/admin/leadgen/assets/persona-image', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ site_id: siteId, persona_key: personaKey, alt_text: altVal || undefined })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      el.disabled = false;
      if (!res.ok || !res.body || !res.body.storage_key) {
        showInlineNote(errEl, (res.body && res.body.error) ? res.body.error : 'Persona image generation failed.');
        return;
      }
      // P5a's explicit type-seam warning: the item's media_id is the
      // STORAGE-KEY STRING (storage_key) — NEVER outcome.media_id, a
      // DIFFERENT, numeric media-table row id the SAME response also carries.
      var mediaInput = itemRow.querySelector('[data-list-field="media_id"]');
      if (mediaInput) { mediaInput.value = res.body.storage_key; }
      var span = itemRow.querySelector('[data-media-field]');
      if (span) { syncMediaField(span); }
      if (altEl && altEl.value === '') {
        var opt = personaEl && personaEl.selectedIndex >= 0 ? personaEl.options[personaEl.selectedIndex] : null;
        altEl.value = opt ? ('Persona: ' + opt.textContent) : 'Persona portrait';
      }
      writeConfigValue('images', collectImages());
    }).catch(function () {
      el.disabled = false;
      showInlineNote(errEl, 'Network error \\u2014 please try again.');
    });
  });

  // F (10F): the "Upload a logo file…" button — a hidden file input triggered
  // by a visible styled button; on file selection, POST straight to P5c's
  // sanitized endpoint (SVG runs the allowlist sanitizer; PNG/JPEG pass the
  // raster check). The upload targets the LAST existing brand-logo row (an
  // empty one just added via "+ Add a logo" is the common flow) or creates a
  // fresh row when the list is empty.
  function nearestListRow(listKey, rowSelector) {
    var list = tplList(listKey);
    if (!list) { return null; }
    var rows = list.querySelectorAll(rowSelector);
    if (rows.length > 0) { return rows[rows.length - 1]; }
    var row = cloneTplRow(listKey);
    if (row) { list.appendChild(row); }
    return row;
  }
  (function () {
    var uploadBtn = root.querySelector('[data-bl-upload-btn]');
    var uploadInput = root.querySelector('[data-bl-upload-input]');
    var uploadError = root.querySelector('[data-bl-upload-error]');
    if (!uploadBtn || !uploadInput) { return; }
    uploadBtn.addEventListener('click', function () { uploadInput.click(); });
    uploadInput.addEventListener('change', function () {
      var file = uploadInput.files && uploadInput.files[0];
      if (!file) { return; }
      showInlineNote(uploadError, null);
      uploadBtn.disabled = true;
      var fd = new FormData();
      fd.append('file', file, file.name);
      fd.append('site_id', siteId || '');
      fetch('/api/admin/leadgen/assets/brand-logo', { method: 'POST', credentials: 'same-origin', body: fd })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          uploadBtn.disabled = false;
          uploadInput.value = '';
          if (!res.ok || !res.body || !res.body.storage_key) {
            showInlineNote(uploadError, (res.body && res.body.error) ? res.body.error : 'Upload failed.');
            return;
          }
          var row = nearestListRow('brand_logos.items', '[data-bl-item-row]');
          if (row) {
            var mediaInput = row.querySelector('[data-list-field="media_id"]');
            if (mediaInput) { mediaInput.value = res.body.storage_key; }
            var span = row.querySelector('[data-media-field]');
            if (span) { syncMediaField(span); }
          }
          writeConfigValue('brand_logos', collectBrandLogos());
        })
        .catch(function () {
          uploadBtn.disabled = false;
          uploadInput.value = '';
          showInlineNote(uploadError, 'Network error \\u2014 please try again.');
        });
    });
  }());

  // --- the canvas (server-rendered composed page in a srcdoc iframe) ---------
  var canvas = byId('lg-preview-iframe');
  var previewTimer = null;
  // DEV-58 (Phase D): the draft params mirror the STORED columns 1:1 —
  // draft_frame_config = the working FUNNEL frame, draft_theme = the working
  // funnel theme, and UNSAVED per-arm override edits ride the ADDITIVE
  // draft_frame_overrides param (the same frame+theme split as the stored
  // column). The server substitutes the WORKING overrides for the stored
  // ones in the same composition slot, so re-editing a field that ALREADY
  // has a stored override previews the WORKING value exactly (render-only;
  // nothing persists).
  function draftFrameConfig() {
    var d = deepClone(workingFrame);
    if (d.template === undefined) { d.template = currentTemplateId(); }
    d.version = 1;
    return d;
  }
  function draftTheme() {
    return deepClone(workingTheme);
  }
  // Attach the per-arm overrides draft ONLY while the arm has unsaved
  // override edits ({} substitutes "no overrides" for this render — the
  // preview mirror of the save payload's null). Untouched arms keep the
  // server-side STORED merge.
  function draftOverridesParam(body) {
    if (overridesDirty) { body.draft_frame_overrides = deepClone(workingOverrides); }
    return body;
  }
  function canvasStatus(text) {
    var el = byId('lg-canvas-status');
    if (el) { clearChildren(el); if (text) { el.appendChild(document.createTextNode(text)); } }
  }
  var REGION_SELECT_CSS = '[data-frame-region]{cursor:pointer}' +
    '.lg-region-sel{outline:3px solid #2563eb;outline-offset:-3px}';
  function setCanvasDoc(bodyHtml, css) {
    if (!canvas) { return; }
    canvas.style.width = viewport === 'mobile' ? '375px' : '1280px';
    var doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + (css || '') + REGION_SELECT_CSS + '</style></head><body>' + (bodyHtml || '') + '</body></html>';
    canvas.setAttribute('srcdoc', doc);
  }
  function slideStillPresent(publicId) {
    if (!publicId) { return false; }
    var rows = root.querySelectorAll('.lg-section-row[data-section-public-id]');
    var i;
    for (i = 0; i < rows.length; i++) {
      if (rows[i].getAttribute('data-section-public-id') === publicId) { return true; }
    }
    return false;
  }
  function previewBody(draftF) {
    var body = draftOverridesParam({
      mode: previewMode,
      viewport: viewport,
      draft_frame_config: draftF === undefined ? draftFrameConfig() : draftF,
      draft_theme: draftTheme()
    });
    if (siteId) { body.site_id = siteId; }
    // a removed/unsaved slide must not ride the POST (the server 400s on a
    // public id outside the PERSISTED order) — fall back to the first slide.
    if (previewMode === 'section' && currentSlideId && slideStillPresent(currentSlideId)) {
      body.section_public_id = currentSlideId;
    }
    // Phase D stepper perf: long funnels fetch ONE composed page per step.
    if (previewMode === 'all' && lazyAllMode()) { body.page = pageIndex + 1; }
    return body;
  }
  // ONE preview endpoint for the canvas AND the theme mini preview (13 §13.4).
  function previewUrl() { return '/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId) + '/preview'; }
  // Monotonic render-request sequence: two overlapping preview POSTs can
  // resolve out of order, and a stale (older) response must never overwrite
  // the newer render. Every renderPreview call takes the next seq; a response
  // (or failure) applies only while its seq is still the latest issued.
  var previewSeq = 0;
  function renderPreview(draftF) {
    previewSeq += 1;
    var seq = previewSeq;
    fetch(previewUrl(), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(previewBody(draftF))
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (seq !== previewSeq) { return; } // stale — a newer request owns the canvas
      if (!res.ok) {
        canvasStatus(res.body && res.body.error ? 'Preview failed: ' + res.body.error : 'Preview failed');
        return;
      }
      canvasStatus('');
      var p = res.body.preview || {};
      lastCss = p.css || '';
      if (typeof p.section_count === 'number') { knownSectionCount = p.section_count; }
      if (previewMode === 'all') {
        if (typeof p.page === 'number') {
          // Phase D lazy leg: ONE composed page (html) for step p.page.
          pages = [];
          pageCount = typeof p.section_count === 'number' ? p.section_count : 0;
          if (pageIndex >= pageCount) { pageIndex = pageCount > 0 ? pageCount - 1 : 0; }
          setCanvasDoc(p.html || '', lastCss);
          updateStepLabel();
        } else {
          pages = p.pages || [];
          pageCount = pages.length;
          if (pageIndex >= pages.length) { pageIndex = 0; }
          setCanvasDoc(pages[pageIndex] || '', lastCss);
          updateStepLabel();
        }
      } else {
        setCanvasDoc(p.html || '', lastCss);
      }
    }).catch(function () {
      if (seq !== previewSeq) { return; } // stale failure — never clobber the newer render's status
      canvasStatus('Preview failed: network error');
    });
  }
  function schedulePreview() {
    if (previewTimer) { window.clearTimeout(previewTimer); }
    previewTimer = window.setTimeout(function () { previewTimer = null; renderPreview(); }, 300);
  }

  // --- 09 §9.3 mini preview (DEV-60 d): the REAL preview machinery ------------
  // A tiny debounced draft_theme POST to the SAME endpoint in the cheap
  // frame-only mode (button/card/progress chrome rendered by the REAL
  // presets), replacing the old hand-rolled spans. Fetches only while the
  // theme editor is OPEN.
  var miniTimer = null;
  var miniSeq = 0;
  var themeMiniOpen = false;
  function miniStatus(text) {
    var el = byId('lg-theme-minipreview-status');
    if (el) { clearChildren(el); if (text) { el.appendChild(document.createTextNode(text)); } }
  }
  function renderMiniPreview() {
    var mount = byId('lg-theme-minipreview');
    var frame = byId('lg-theme-minipreview-frame');
    if (!mount || !frame) { return; }
    miniSeq += 1;
    var seq = miniSeq;
    fetch(previewUrl(), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(draftOverridesParam({
        mode: mount.getAttribute('data-mini-preview-mode') || 'frame',
        viewport: 'desktop',
        draft_frame_config: draftFrameConfig(),
        draft_theme: draftTheme()
      }))
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
      if (seq !== miniSeq) { return; }
      if (!res.ok) { miniStatus('Theme preview failed.'); return; }
      miniStatus('');
      var p = res.body.preview || {};
      frame.setAttribute('srcdoc', '<!doctype html><html><head><meta charset="utf-8"><style>' + (p.css || '') + '</style></head><body>' + (p.html || '') + '</body></html>');
    }).catch(function () {
      if (seq !== miniSeq) { return; }
      miniStatus('Theme preview failed: network error');
    });
  }
  function scheduleMiniPreview() {
    if (!themeMiniOpen) { return; }
    if (miniTimer) { window.clearTimeout(miniTimer); }
    miniTimer = window.setTimeout(function () { miniTimer = null; renderMiniPreview(); }, 300);
  }

  // ==========================================================================
  // P6b — theme PRESETS (the KV lg-funnel-themes catalog): a picker to apply
  // a saved preset to this funnel/variant, and the theme A/B one-click fork.
  // Full create/edit/delete lives in the embedded ui-theme-manager.ts iframe
  // (#lg-theme-presets-frame) — this only needs to KNOW the catalog (for the
  // <select>) and call the two existing endpoints (PUT funnel theme / PUT
  // variant frame_overrides_json) the standalone Themes manager itself has no
  // reason to know about (it has no "current funnel" context).
  // ==========================================================================

  function loadThemePresetOptions() {
    var sel = byId('lg-theme-preset-select');
    if (!sel) { return; }
    var keep = sel.value;
    fetch('/api/admin/leadgen/themes', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        var items = (body && body.items) || [];
        clearChildren(sel);
        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = items.length === 0 ? 'No presets yet \\u2014 create one below' : 'Choose a preset\\u2026';
        sel.appendChild(placeholder);
        var i;
        for (i = 0; i < items.length; i++) {
          var opt = document.createElement('option');
          opt.value = items[i].id;
          opt.textContent = items[i].name;
          sel.appendChild(opt);
        }
        if (keep) { sel.value = keep; }
      })
      .catch(function () { /* leave the select as-is on a transient network error */ });
  }

  // Fork the SELECTED variant, then apply the new arm's traffic split (and
  // shrink the original's to match, keeping Σ==10000) — the SAME §16.2 fork+
  // allocation mechanism "Fork this variant"/"Add variant"/"A/B this theme"
  // all share. themeIdOrNull !== null additionally assigns that preset as the
  // new arm's theme override (frame_overrides_json.theme_id) — the theme A/B
  // one-click path; null leaves the fork's own cloned theme untouched (the
  // generic "Add variant" path).
  // §16.2 line 35 (quotes-handlers.ts putVariantHandler): a traffic_allocation_bp
  // CHANGE on an ACTIVE variant whose funnel has a RUNNING test is refused
  // (409) — "the operator rebalances via stop -> edit -> start, and START
  // bumps the revision + re-gates Σ==10000 + cleanly re-buckets." fork's own
  // precondition requires a running test to bootstrap the 2nd arm, so
  // forkWithAllocation/saveAllocations always hit this guard when they try to
  // set a CUSTOM split afterward — both ride that exact stop -> edit -> start
  // cycle below rather than the old bare concurrent PUTs.
  function findRunningExperimentId() {
    var stopBtn = root.querySelector('[data-stop-experiment]');
    return stopBtn ? stopBtn.getAttribute('data-stop-experiment') : null;
  }
  function stopExperimentReq(id) {
    return fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(id) + '/stop', {
      method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }
  function startExperimentReq(id) {
    return fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(id) + '/start', {
      method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); });
  }

  function forkWithAllocation(themeIdOrNull) {
    var pctStr = window.prompt("New variant's share of traffic, in percent (the rest stays with the current variant):", '50');
    if (pctStr === null) { return; }
    var pct = parseFloat(pctStr);
    if (!(pct >= 0 && pct <= 100)) { showMsg('lg-quote-error', 'Enter a number between 0 and 100.'); return; }
    var newBp = Math.round(pct * 100);
    var keepBp = 10000 - newBp;
    hideMsg('lg-quote-error');
    fetch('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId) + '/fork', {
      method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
      if (!res.ok || !res.body || !res.body.public_id) {
        showMsg('lg-quote-error', (res.body && res.body.error) ? res.body.error : 'Could not add a variant.');
        return null;
      }
      var newVariantId = res.body.public_id;
      var newPatch = { traffic_allocation_bp: newBp };
      if (themeIdOrNull) { newPatch.frame_overrides_json = { theme_id: themeIdOrNull }; }
      var runningTestId = findRunningExperimentId();
      var stopStep = runningTestId ? stopExperimentReq(runningTestId) : Promise.resolve({ ok: true, body: null });
      return stopStep.then(function (stopRes) {
        if (!stopRes.ok) {
          showMsg('lg-quote-error', (stopRes.body && stopRes.body.error) ? stopRes.body.error : 'The variant was added, but stopping the test to set its split failed — set it from the A/B tab.');
          return;
        }
        return Promise.all([
          fetch('/api/admin/leadgen/variants/' + encodeURIComponent(newVariantId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(newPatch)
          }).then(function (r2) { return r2.json().then(function (j2) { return { ok: r2.ok, body: j2 }; }); }),
          fetch('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ traffic_allocation_bp: keepBp })
          }).then(function (r3) { return r3.json().then(function (j3) { return { ok: r3.ok, body: j3 }; }); })
        ]).then(function (results) {
          var failed = null;
          var k;
          for (k = 0; k < results.length; k++) { if (!results[k].ok) { failed = results[k].body; break; } }
          if (failed) {
            showMsg('lg-quote-error', (failed && failed.error) ? failed.error : 'The variant was added, but saving the traffic split failed — set it from the A/B tab.');
            return;
          }
          var startStep = runningTestId ? startExperimentReq(runningTestId) : Promise.resolve({ ok: true, body: null });
          return startStep.then(function (startRes) {
            if (!startRes.ok) {
              showMsg('lg-quote-error', (startRes.body && startRes.body.fields && startRes.body.fields.traffic_allocation_bp) ? startRes.body.fields.traffic_allocation_bp : ((startRes.body && startRes.body.error) ? startRes.body.error : 'The split saved, but restarting the test failed — start it from the A/B tab.'));
              return;
            }
            window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/edit?variant=' + encodeURIComponent(variantPublicId);
          });
        });
      });
    }).catch(function () {
      showMsg('lg-quote-error', 'Network error while adding a variant.');
    });
  }

  function wireThemePresets() {
    var applyBtn = byId('lg-theme-preset-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        var sel = byId('lg-theme-preset-select');
        var themeId = sel ? sel.value : '';
        if (!themeId) { showMsg('lg-quote-error', 'Pick a preset first.'); return; }
        hideMsg('lg-quote-error');
        applyBtn.disabled = true;
        // §4.5-aware: apply to the VARIANT's own override while this arm has
        // the theme override switch ON, to the FUNNEL otherwise — the SAME
        // override-vs-funnel split writeThemeValue/applyPaletteValue already
        // respect for every other theme edit on this panel.
        var useOverride = !isControl && overrideMode['theme'] === 'override';
        var req = useOverride
          ? fetch('/api/admin/leadgen/variants/' + encodeURIComponent(variantPublicId), {
              method: 'PUT', credentials: 'same-origin',
              headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ frame_overrides_json: { theme_id: themeId } })
            })
          : fetch('/api/admin/leadgen/funnels/' + encodeURIComponent(funnelPublicId) + '/theme', {
              method: 'PUT', credentials: 'same-origin',
              headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ theme_json: { theme_id: themeId } })
            });
        req.then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
          if (res.ok) { window.location.reload(); return; }
          applyBtn.disabled = false;
          showMsg('lg-quote-error', (res.body && res.body.error) ? res.body.error : 'Apply failed.');
        }).catch(function () {
          applyBtn.disabled = false;
          showMsg('lg-quote-error', 'Network error while applying the preset.');
        });
      });
    }

    var abThisBtn = byId('lg-theme-ab-this');
    if (abThisBtn) {
      abThisBtn.addEventListener('click', function () {
        var sel = byId('lg-theme-preset-select');
        var themeId = sel ? sel.value : '';
        if (!themeId) { showMsg('lg-quote-error', 'Pick a preset first, then A/B it.'); return; }
        forkWithAllocation(themeId);
      });
    }

    var addVariantBtn = byId('lg-add-variant');
    if (addVariantBtn) {
      addVariantBtn.addEventListener('click', function () { forkWithAllocation(null); });
    }

    // The embedded theme-manager reloads ITSELF (a real navigation, not a
    // postMessage) after every create/delete inside the iframe — refreshing
    // the picker on its load event keeps "Apply"/"A/B this theme" accurate
    // without polling.
    var presetsFrame = byId('lg-theme-presets-frame');
    if (presetsFrame) {
      presetsFrame.addEventListener('load', function () { loadThemePresetOptions(); });
    }
  }
  wireThemePresets();
  // The Themes tab is not necessarily the boot tab (builder is) — populate
  // the picker eagerly too so it is never empty if the operator's very first
  // click lands on "Apply"/"A/B this theme" before a tab-switch fires (the
  // activate('themes') hook above also refreshes it on every switch).
  loadThemePresetOptions();

  // --- region click-select (same-origin contentDocument delegation) ----------
  function outlineSelection(doc) {
    var all = doc.querySelectorAll('[data-frame-region]');
    var i;
    for (i = 0; i < all.length; i++) {
      var name = all[i].getAttribute('data-frame-region');
      var match = selectedRegion !== null && (name === selectedRegion || (selectedRegion === 'header' && name === 'logo'));
      var cls = String(all[i].className || '').replace(/\\s*lg-region-sel/g, '');
      all[i].className = match ? cls + ' lg-region-sel' : cls;
    }
  }
  function showRegionPanel(name) {
    var panels = root.querySelectorAll('[data-region-panel]');
    var i;
    for (i = 0; i < panels.length; i++) {
      panels[i].className = panels[i].getAttribute('data-region-panel') === name
        ? 'lg-inspector-panel lg-panel-card active' : 'lg-inspector-panel lg-panel-card';
    }
    var hint = byId('lg-inspector-hint');
    if (hint) { hint.hidden = name !== null && name !== undefined; }
  }
  function hideSlotBanner() {
    var banner = byId('lg-slot-banner');
    if (banner) { banner.className = 'lg-slot-banner lg-hidden'; }
  }
  function showSlotBanner() {
    var banner = byId('lg-slot-banner');
    if (!banner) { return; }
    var link = byId('lg-slot-banner-open');
    if (link) {
      link.setAttribute('href', currentSlideId
        ? '/admin/leadgen/sections/' + encodeURIComponent(currentSlideId) + '/edit'
        : '/admin/leadgen/sections');
    }
    banner.className = 'lg-slot-banner';
  }
  function selectRegion(name) {
    selectedRegion = name;
    showRegionPanel(name);
    if (canvas && canvas.contentDocument) { outlineSelection(canvas.contentDocument); }
  }
  function onCanvasClick(ev) {
    if (ev.preventDefault) { ev.preventDefault(); }
    var node = ev.target;
    var interior = false;
    var region = null;
    while (node && node.getAttribute) {
      if (node.getAttribute('data-lg-section') !== null || node.getAttribute('data-lg-slot-placeholder') !== null) { interior = true; }
      var r = node.getAttribute('data-frame-region');
      if (r !== null && r !== undefined && r !== '') { region = r; break; }
      node = node.parentNode;
    }
    if (region === 'logo') { region = 'header'; }
    if (region === 'section_slot' && interior) { showSlotBanner(); return; }
    hideSlotBanner();
    // 04 §4.1/§4.4 background fallback: the .lg-frame-background layer is
    // pointer-events:none BEHIND the content (frame CSS), so a canvas click
    // can never target it. A click whose walk found NO region and NO
    // slot-interior landed on #lg-funnel-root itself (or bare canvas) — the
    // page background IS what was clicked. A real region hit above always
    // wins (the walk broke on the nearest data-frame-region stamp).
    if (region === null && !interior) { region = 'background'; }
    if (region !== null) { selectRegion(region); }
  }
  if (canvas) {
    canvas.addEventListener('load', function () {
      var doc = canvas.contentDocument;
      if (!doc) { return; }
      doc.addEventListener('click', onCanvasClick);
      outlineSelection(doc);
    });
  }

  // --- toolbar: viewport / preview mode / stepper / site / variant mirror ----
  function pressGroup(attr, value) {
    var buttons = root.querySelectorAll('[' + attr + ']');
    var i;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', buttons[i].getAttribute(attr) === value ? 'true' : 'false');
    }
  }
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var vp = el.getAttribute('data-viewport-btn');
    if (vp !== null) { viewport = vp; pressGroup('data-viewport-btn', vp); schedulePreview(); return; }
    var pm = el.getAttribute('data-preview-mode-btn');
    if (pm !== null) {
      previewMode = pm;
      pressGroup('data-preview-mode-btn', pm);
      var steps = byId('lg-step-controls');
      if (steps) { steps.className = pm === 'all' ? 'lg-step-controls' : 'lg-step-controls lg-hidden'; }
      pageIndex = 0;
      schedulePreview();
      return;
    }
  });
  function updateStepLabel() {
    var label = byId('lg-step-label');
    if (label) {
      clearChildren(label);
      // pageCount == pages.length in the eager flow (byte-identical label);
      // in the lazy flow it is the server's section_count echo.
      label.appendChild(document.createTextNode('Slide ' + (pageCount === 0 ? 0 : pageIndex + 1) + ' of ' + pageCount));
    }
  }
  (function () {
    var prev = byId('lg-step-prev');
    var next = byId('lg-step-next');
    // Eager flow (≤ threshold): swap the already-fetched page locally.
    // Lazy flow (> threshold): fetch the ONE composed page for the new step
    // (renderPreview reads pageIndex through previewBody's page param); the
    // label updates in renderPreview's completion path AFTER that per-step
    // response lands — canvas and label always move together (a stale
    // response never leaves the label ahead of the canvas; the seq guard
    // drops it for both).
    function showStep() {
      if (lazyAllMode()) { renderPreview(); return; }
      setCanvasDoc(pages[pageIndex] || '', lastCss);
      updateStepLabel();
    }
    if (prev) { prev.addEventListener('click', function () { if (pageIndex > 0) { pageIndex--; showStep(); } }); }
    if (next) { next.addEventListener('click', function () { if (pageIndex < pageCount - 1) { pageIndex++; showStep(); } }); }
  }());
  (function () {
    var selects = root.querySelectorAll('[data-site-select]');
    var i;
    function onSiteChange() {
      siteId = this.value || '';
      var j;
      for (j = 0; j < selects.length; j++) { if (selects[j] !== this) { selects[j].value = siteId; } }
      schedulePreview();
    }
    for (i = 0; i < selects.length; i++) { selects[i].addEventListener('change', onSiteChange); }
  }());
  (function () {
    var mirror = byId('lg-canvas-variant-select');
    if (mirror) {
      mirror.addEventListener('change', function () {
        window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/edit?variant=' + encodeURIComponent(this.value);
      });
    }
  }());

  // --- structure panel: slide selection --------------------------------------
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute || el.getAttribute('data-select-slide') === null) { return; }
    var row = el;
    while (row && row.getAttribute && row.getAttribute('data-section-public-id') === null) { row = row.parentNode; }
    if (!row || !row.getAttribute) { return; }
    currentSlideId = row.getAttribute('data-section-public-id') || null;
    var rows = root.querySelectorAll('.lg-structure-row[data-section-public-id]');
    var i;
    for (i = 0; i < rows.length; i++) {
      var cls = String(rows[i].className).replace(/\\s*lg-slide-current/g, '');
      rows[i].className = rows[i] === row ? cls + ' lg-slide-current' : cls;
    }
    if (previewMode === 'section') { schedulePreview(); }
  });

  // --- template picker (§4.3, C5 preview-before-apply) -----------------------
  // Round-4 P5b: #lg-template-btn keeps its ORIGINAL inline toggle — the
  // 6-arrangement picker stays canvas-embedded (reported conflict: moving it
  // behind the Templates tab hides the canvas mid preview-before-apply,
  // breaking test-ui/leadgen-quote-builder.spec.ts rows (2) and (6), VERIFIED
  // failing — see renderTemplatePicker's doc comment + the P5b report).
  // #lg-theme-btn DOES jump to the new "Themes" tab per the operator
  // restructure spec's explicit, unambiguous instruction for that surface
  // (deliverable 1) — activate() does the mini-preview kick for 'themes'.
  function togglePanel(id) {
    var panel = byId(id);
    if (!panel) { return false; }
    var open = String(panel.className).indexOf('lg-hidden') >= 0;
    panel.className = open ? 'lg-panel-card' : 'lg-panel-card lg-hidden';
    return open;
  }
  (function () {
    var btn = byId('lg-template-btn');
    if (btn) { btn.addEventListener('click', function () { togglePanel('lg-template-picker'); }); }
    var themeBtn = byId('lg-theme-btn');
    if (themeBtn) { themeBtn.addEventListener('click', function () { activate('themes'); }); }
  }());
  function showTemplateConfirm(confirmations) {
    var box = byId('lg-template-confirm');
    var list = byId('lg-template-confirm-list');
    if (!box || !list) { return; }
    clearChildren(list);
    var lines = confirmations.length > 0 ? confirmations : ['Your content is unaffected by this switch.'];
    var i;
    for (i = 0; i < lines.length; i++) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(lines[i]));
      list.appendChild(li);
    }
    box.className = '';
  }
  function hideTemplateConfirm() {
    var box = byId('lg-template-confirm');
    if (box) { box.className = 'lg-hidden'; }
  }
  root.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el.getAttribute && el.getAttribute('data-template-pick') === null) { el = el.parentNode; }
    if (!el || !el.getAttribute) { return; }
    var id = el.getAttribute('data-template-pick');
    var cards = root.querySelectorAll('[data-template-pick]');
    var i;
    for (i = 0; i < cards.length; i++) {
      cards[i].className = cards[i] === el ? 'lg-template-card selected' : 'lg-template-card';
    }
    fetch('/api/admin/leadgen/funnels/' + encodeURIComponent(funnelPublicId) + '/frame?switch_to=' + encodeURIComponent(id), {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
      if (!res.ok || !res.body || !res.body.merged) {
        canvasStatus('Template preview failed.');
        return;
      }
      pendingSwitch = { id: id, merged: res.body.merged };
      showTemplateConfirm(res.body.confirmations || []);
      // C5: preview-before-apply — the canvas shows the WOULD-BE result;
      // nothing persists (and Cancel restores the working config).
      renderPreview(res.body.merged);
    });
  });
  (function () {
    var apply = byId('lg-template-apply');
    var cancel = byId('lg-template-cancel');
    if (apply) {
      apply.addEventListener('click', function () {
        if (!pendingSwitch) { return; }
        workingFrame = deepClone(pendingSwitch.merged);
        frameDirty = true;
        markDirty();
        pendingSwitch = null;
        hideTemplateConfirm();
        populateAllControls();
        schedulePreview();
      });
    }
    if (cancel) {
      cancel.addEventListener('click', function () {
        pendingSwitch = null;
        hideTemplateConfirm();
        schedulePreview();
      });
    }
  }());

  // --- studio boot ------------------------------------------------------------
  initOverrideSwitches();
  populateAllControls();
  updateOverrideBadge();
  schedulePreview();

  // --- A/B (§16.2): allocation Σ, save, lifecycle (create/start/stop), preview -
  function allocInputs() { return root.querySelectorAll('[data-alloc-input]'); }
  function recomputeAllocSum() {
    var inputs = allocInputs();
    var sumBp = 0;
    var i;
    for (i = 0; i < inputs.length; i++) {
      var pct = parseFloat(inputs[i].value);
      if (isFinite(pct)) { sumBp += Math.round(pct * 100); }
    }
    var sumEl = root.querySelector('[data-alloc-sum]');
    var noteEl = root.querySelector('[data-alloc-sum-note]');
    if (sumEl) { sumEl.textContent = (sumBp / 100).toFixed(2) + '%'; }
    if (noteEl) {
      noteEl.textContent = sumBp === 10000 ? '(ok — sums to 100%)' : '(must equal 100% to start)';
    }
    return sumBp;
  }
  var allocList = byId('lg-ab-variant-list');
  if (allocList) {
    allocList.addEventListener('input', function (ev) {
      if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-alloc-input') !== null) { recomputeAllocSum(); }
    });
    recomputeAllocSum();
  }

  var saveAllocBtn = byId('lg-save-allocations');
  if (saveAllocBtn) {
    saveAllocBtn.addEventListener('click', function () {
      var inputs = allocInputs();
      var edits = [];
      var i;
      for (i = 0; i < inputs.length; i++) {
        var vid = inputs[i].getAttribute('data-variant-id');
        var pct = parseFloat(inputs[i].value);
        if (!vid || !isFinite(pct)) { continue; }
        edits.push({ vid: vid, bp: Math.round(pct * 100) });
      }
      saveAllocBtn.disabled = true;
      // §16.2 stop -> edit -> start (see forkWithAllocation's doc comment
      // above): a traffic_allocation_bp CHANGE while the funnel's test is
      // RUNNING is refused (409) — stop first when one is running, restart
      // after the edits land (start re-gates Σ==10000 + bumps the revision).
      var runningTestId = findRunningExperimentId();
      var stopStep = runningTestId ? stopExperimentReq(runningTestId) : Promise.resolve({ ok: true, body: null });
      stopStep.then(function (stopRes) {
        if (!stopRes.ok) {
          saveAllocBtn.disabled = false;
          showMsg('lg-quote-error', (stopRes.body && stopRes.body.error) ? stopRes.body.error : 'Stopping the running test to edit allocations failed.');
          return;
        }
        var puts = [];
        var j;
        for (j = 0; j < edits.length; j++) {
          puts.push(fetch('/api/admin/leadgen/variants/' + encodeURIComponent(edits[j].vid), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ traffic_allocation_bp: edits[j].bp })
          }).then(function (r) { return r.json().then(function (j2) { return { ok: r.ok, body: j2 }; }); }));
        }
        return Promise.all(puts).then(function (results) {
          var k;
          var failed = null;
          for (k = 0; k < results.length; k++) { if (!results[k].ok) { failed = results[k].body; break; } }
          if (failed) {
            saveAllocBtn.disabled = false;
            showMsg('lg-quote-error', (failed && failed.fields && failed.fields.traffic_allocation_bp) ? failed.fields.traffic_allocation_bp : 'Allocation save failed');
            return;
          }
          var startStep = runningTestId ? startExperimentReq(runningTestId) : Promise.resolve({ ok: true, body: null });
          return startStep.then(function (startRes) {
            saveAllocBtn.disabled = false;
            if (!startRes.ok) {
              showMsg('lg-quote-error', (startRes.body && startRes.body.fields && startRes.body.fields.traffic_allocation_bp) ? startRes.body.fields.traffic_allocation_bp : ((startRes.body && startRes.body.error) ? startRes.body.error : 'Allocations saved, but restarting the test failed — start it from the A/B tab.'));
              return;
            }
            // this side-save owns the allocation inputs' dirty contribution —
            // a full success clears it (no spurious beforeunload afterwards)
            allocDirty = false;
            showMsg('lg-quote-ok', 'Allocations saved.');
            recomputeAllocSum();
          });
        });
      });
    });
  }

  var createExpBtn = byId('lg-create-experiment');
  if (createExpBtn) {
    createExpBtn.addEventListener('click', function () {
      createExpBtn.disabled = true;
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/experiments', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({})
      }).then(function (r) { return r.json(); }).then(function () { window.location.reload(); });
    });
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }

    var forkId = el.getAttribute('data-fork-variant');
    if (forkId) {
      fetch('/api/admin/leadgen/variants/' + encodeURIComponent(forkId) + '/fork', {
        method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        if (body && body.public_id) { window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/edit?variant=' + encodeURIComponent(body.public_id); }
      });
      return;
    }

    var startId = el.getAttribute('data-start-experiment');
    if (startId) {
      el.disabled = true;
      fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(startId) + '/start', {
        method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        el.disabled = false;
        if (res.ok) { window.location.reload(); }
        else { showMsg('lg-quote-error', (res.body && res.body.fields && res.body.fields.traffic_allocation_bp) ? res.body.fields.traffic_allocation_bp : ((res.body && res.body.error) ? res.body.error : 'Start failed')); }
      });
      return;
    }

    var stopId = el.getAttribute('data-stop-experiment');
    if (stopId) {
      el.disabled = true;
      fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(stopId) + '/stop', {
        method: 'POST', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function () { window.location.reload(); });
      return;
    }

    var previewId = el.getAttribute('data-preview-assignment');
    if (previewId) {
      var sessEl = byId('lg-ab-preview-session');
      var resultEl = byId('lg-ab-preview-result');
      var sid = sessEl && sessEl.value ? sessEl.value : '';
      if (!sid) { if (resultEl) { resultEl.textContent = 'Enter a sample session id first.'; } return; }
      fetch('/api/admin/leadgen/experiments/' + encodeURIComponent(previewId) + '/assignment-preview?session_id=' + encodeURIComponent(sid), {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); }).then(function (res) {
        if (!resultEl) { return; }
        if (res.ok && res.body && res.body.variant) {
          resultEl.textContent = 'Session "' + sid + '" maps to variant ' + res.body.variant.variant_label + ' (' + res.body.variant.funnel_variant_id + '), bucket ' + res.body.assignment_bucket + ' of 10000.';
        } else {
          resultEl.textContent = (res.body && res.body.error) ? res.body.error : 'Preview failed.';
        }
      });
      return;
    }
  });

  // --- activation (per-site PUT/DELETE) -------------------------------------
  var activationList = byId('lg-activation-list');
  if (activationList) {
    activationList.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) { return; }
      var row = el;
      while (row && row.getAttribute && !row.hasAttribute('data-site-id')) { row = row.parentNode; }
      if (!row || !row.getAttribute) { return; }
      var siteId = row.getAttribute('data-site-id');
      if (el.hasAttribute('data-save-activation')) {
        var enabled = row.querySelector('[data-site-enabled]').checked;
        var slugEl = row.querySelector('[data-site-slug]');
        var slug = slugEl && slugEl.value ? slugEl.value : null;
        fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/activation/' + encodeURIComponent(siteId), {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ enabled: enabled, slug: slug })
        }).then(function (r) {
          return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
        }).then(function (res) {
          if (res.ok) {
            showMsg('lg-quote-ok', 'Activation saved for ' + siteId);
            // 05 5.2: the activation PUT recomputes the verdict — keep the
            // preflight panel + badge in sync with the authoritative state.
            if (res.body && res.body.activation_preflight) { renderPreflight(res.body.activation_preflight); }
            return;
          }
          // 05 5.2 + 14 14.2: the activation gate 409s with the normative
          // report + the additive problems[] (C2 LIVE) — render BOTH in the
          // preflight panel (operator copy), never raw JSON.
          if (res.status === 409 && res.body && res.body.error === 'quote_activation_blocked') {
            renderPreflight({ ok: false, blocks: res.body.blocks || [], problems: res.body.problems || [] });
            showMsg('lg-quote-error', 'Cannot activate this Quote \\u2014 fix the blocking issues listed in the Activation preflight panel.');
            return;
          }
          showMsg('lg-quote-error', (res.body && res.body.error ? res.body.error : 'Activation failed') + (res.body && res.body.fields ? ': ' + JSON.stringify(res.body.fields) : ''));
        });
        return;
      }
      if (el.hasAttribute('data-deactivate')) {
        fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/activation/' + encodeURIComponent(siteId), {
          method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
        }).then(function () { window.location.reload(); });
      }
    });
  }

  // --- analytics panel (§15.6 read-only) ------------------------------------
  var analyticsLoaded = false;
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return (n * 100).toFixed(2) + '%'; }
  function orDash(v) { if (v === null || v === undefined) { return '\\u2014'; } var n = Number(v); return isFinite(n) ? String(n) : '\\u2014'; }
  function money(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return n.toFixed(2); }
  function loadAnalytics() {
    if (analyticsLoaded) { return; }
    analyticsLoaded = true;
    fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/analytics', {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (body) {
      var tbody = byId('lg-analytics-body');
      if (!tbody) { return; }
      while (tbody.firstChild) { tbody.removeChild(tbody.firstChild); }
      var funnels = (body && body.analytics && body.analytics.funnels) ? body.analytics.funnels : [];
      if (funnels.length === 0) {
        var tr0 = document.createElement('tr');
        var td0 = document.createElement('td');
        td0.setAttribute('colspan', '10');
        td0.className = 'form-help';
        td0.appendChild(document.createTextNode('No analytics for this timeframe.'));
        tr0.appendChild(td0);
        tbody.appendChild(tr0);
        return;
      }
      var i;
      for (i = 0; i < funnels.length; i++) {
        var f = funnels[i];
        var tr = document.createElement('tr');
        var cells = [f.funnel_id, orDash(f.visits), fmtPct(f.bounce_rate), fmtPct(f.completion_rate), fmtPct(f.cvr_clicks), fmtPct(f.cvr_completed), money(f.avg_rpc), money(f.avg_rps), fmtPct(f.unfilled_rate), money(f.revenue)];
        var k;
        for (k = 0; k < cells.length; k++) {
          var td = document.createElement('td');
          if (k > 0) { td.className = 'lg-num'; }
          td.appendChild(document.createTextNode(String(cells[k])));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
    });
  }

  // --- dirty tracking + unsaved-changes guard -------------------------------
  // Only PERSISTED controls mark unsaved state. Preview/navigation-only
  // widgets never arm beforeunload: the A/B assignment-preview session id,
  // the preview site selectors, the variant switchers, the add-slide picker
  // (the Add button marks dirty itself) and the staged custom-hex pair
  // (persisted only through its Apply button, which marks the theme dirty).
  // Scope routing: allocation inputs feed ONLY the A/B side-save
  // (allocDirty); the lander/design/auction fields and anything inside the
  // section or rules lists are variant-PUT payload (variantDirty); every
  // other persisted control (activation rows, frame/theme controls — whose
  // own handlers set their scoped flags) keeps the blanket flag.
  var VARIANT_FIELD_IDS = { 'lg-lander-enabled': 1, 'lg-lander-headline': 1, 'lg-lander-sub': 1, 'lg-lander-hero': 1, 'lg-funnel-design': 1, 'lg-auction-id': 1 };
  // …plus the DEV-60 widgets with their OWN save paths: the quote-rename
  // input PATCHes immediately via its Save-name button; the media-upload file
  // input persists through the upload POST.
  var NON_PERSISTED_IDS = { 'lg-variant-select': 1, 'lg-canvas-variant-select': 1, 'lg-ab-preview-session': 1, 'lg-add-section-select': 1, 'lg-theme-hex-role': 1, 'lg-theme-hex-value': 1, 'lg-quote-rename-input': 1, 'lg-media-upload-file': 1 };
  function markDirtyFor(el) {
    if (!el || !el.getAttribute) { return; }
    var id = el.id || '';
    if (NON_PERSISTED_IDS[id] === 1) { return; }
    if (el.getAttribute('data-site-select') !== null) { return; }
    if (el.getAttribute('data-alloc-input') !== null) { allocDirty = true; return; }
    if (VARIANT_FIELD_IDS[id] === 1) { markVariantDirty(); return; }
    var node = el;
    while (node && node.getAttribute) {
      if (node.id === 'lg-rule-list' || node.id === 'lg-section-list') { markVariantDirty(); return; }
      node = node.parentNode;
    }
    markDirty();
  }
  root.addEventListener('input', function (ev) { markDirtyFor(ev.target); });
  root.addEventListener('change', function (ev) { markDirtyFor(ev.target); });
  window.addEventListener('beforeunload', function (e) {
    if (dirty || variantDirty || allocDirty || frameDirty || themeDirty || overridesDirty) { e.preventDefault(); e.returnValue = ''; return ''; }
  });
}());

/* ======================================================================== */
/* P3b (S3b.1) funnel-builder BOARD island. Strict ES5: var and function only */
/* -- no arrow functions, no ES6 block-scoped declarations, no backtick       */
/* template strings (layout.ts + the ES5 parse gate). Drag = the in-house    */
/* mouse engine (studio precedent; no native HTML5 DnD, so page.mouse drives */
/* it on BOTH engines). Persistence = the landed P1 endpoints + a reload (the */
/* SSR /structure is the source of truth). A-4/A-5 are rendered VERBATIM     */
/* from the server response. The RIGHT rail is S3b.2's.                      */
/* ======================================================================== */
(function () {
  'use strict';
  var board = document.querySelector('[data-board]');
  if (!board) { return; }
  var shell = document.querySelector('.lg-board-shell');
  var dataEl = document.getElementById('lg-board-data');
  var BOARD = {};
  try { BOARD = JSON.parse((dataEl && (dataEl.textContent || dataEl.innerText)) || '{}'); } catch (eBoard) { BOARD = {}; }
  var quoteId = BOARD.quote_public_id || '';
  var API = '/api/admin/leadgen';

  function reloadPage() { window.location.reload(); }
  function req(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }
  function firstFieldError(body) {
    if (body && body.fields) { var k; for (k in body.fields) { if (Object.prototype.hasOwnProperty.call(body.fields, k)) { return body.fields[k]; } } }
    return (body && body.error) ? body.error : 'Something went wrong. Please try again.';
  }
  function funnelByPublic(pub) {
    var fs = BOARD.funnels || []; var i;
    for (i = 0; i < fs.length; i++) { if (fs[i].public_id === pub) { return fs[i]; } }
    return null;
  }
  function orderedFunnels() {
    var fs = (BOARD.funnels || []).slice();
    fs.sort(function (a, b) { return (a.display_order || a.id) - (b.display_order || b.id); });
    return fs;
  }

  /* ---- inline error (A-4 uniqueness on drop, etc.) ---- */
  function clearInlineErrs() {
    var errs = board.querySelectorAll('.lg-board-inline-err'); var i;
    for (i = 0; i < errs.length; i++) { if (errs[i].parentNode) { errs[i].parentNode.removeChild(errs[i]); } }
  }
  function showInlineErr(nearEl, msg) {
    clearInlineErrs();
    var p = document.createElement('div');
    p.className = 'lg-board-inline-err';
    p.setAttribute('role', 'alert');
    p.appendChild(document.createTextNode(msg));
    if (nearEl && nearEl.parentNode) { nearEl.parentNode.insertBefore(p, nearEl.nextSibling); }
    else { board.insertBefore(p, board.firstChild); }
    if (p.scrollIntoView) { p.scrollIntoView({ block: 'nearest' }); }
  }

  /* ---- variant pages -> PUT pages-array shape (faithful fixed/ab/ruled) ---- */
  function slotToPut(slot) {
    if (slot.kind === 'ab' && slot.allocations) {
      var allocs = []; var k;
      for (k = 0; k < slot.allocations.length; k++) { allocs.push({ section_id: slot.section_ids[k], bp: slot.allocations[k].bp }); }
      return { kind: 'ab', allocations: allocs };
    }
    if (slot.kind === 'ruled' && slot.rules) {
      var cs = slot.rules.cases || []; var order = []; var seen = {}; var i;
      for (i = 0; i < cs.length; i++) { var sid = cs[i].section_id; if (!seen[sid]) { seen[sid] = 1; order.push(sid); } }
      var def = slot.rules.default_section_id;
      if (def !== null && def !== undefined && !seen[def]) { order.push(def); }
      var map = {}; var j; for (j = 0; j < order.length; j++) { map[order[j]] = slot.section_ids[j]; }
      var cases = []; var m; for (m = 0; m < cs.length; m++) { cases.push({ conditions: cs[m].conditions, section_id: map[cs[m].section_id] }); }
      var out = { kind: 'ruled', cases: cases };
      if (def !== null && def !== undefined) { out.default_section_id = map[def]; }
      return out;
    }
    return { kind: 'fixed', section_id: slot.section_ids[0] };
  }
  function funnelPagesToPut(funnel) {
    var pages = funnel.pages || []; var out = []; var i, j;
    for (i = 0; i < pages.length; i++) {
      var slots = []; var ps = pages[i].slots || [];
      for (j = 0; j < ps.length; j++) { slots.push(slotToPut(ps[j])); }
      out.push({ name: null, slots: slots });
    }
    return out;
  }
  function saveFunnel(funnel, nearEl) {
    var variantPub = funnel.active_variant_public_id;
    if (!variantPub) { showInlineErr(nearEl, 'This funnel has no active variant to save into.'); return; }
    req('PUT', API + '/variants/' + encodeURIComponent(variantPub), { pages: funnelPagesToPut(funnel) }).then(function (res) {
      if (!res.ok) { showInlineErr(nearEl, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }
  function saveShared(ids, nearEl) {
    var sections = []; var i; for (i = 0; i < ids.length; i++) { sections.push({ section_id: ids[i] }); }
    req('PUT', API + '/quotes/' + encodeURIComponent(quoteId) + '/shared-page', { sections: sections }).then(function (res) {
      if (!res.ok) { showInlineErr(nearEl, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }

  /* ================= MENUS ================= */
  var menusRoot = document.querySelector('[data-board-menus]');
  var openMenuEl = null;
  var menuCtx = null;
  function hide(el) { if (el) { el.className = el.className.replace(/\\s*lg-hidden/g, '') + ' lg-hidden'; } }
  function show(el) { if (el) { el.className = el.className.replace(/\\s*lg-hidden/g, ''); } }
  function closeMenus() {
    if (openMenuEl) { hide(openMenuEl); openMenuEl = null; }
    menuCtx = null;
  }
  function positionAt(menuEl, anchor) {
    var r = anchor.getBoundingClientRect();
    menuEl.style.top = (r.bottom + 4) + 'px';
    var left = r.left;
    var mw = menuEl.offsetWidth || 190;
    if (left + mw > window.innerWidth - 8) { left = window.innerWidth - mw - 8; }
    if (left < 8) { left = 8; }
    menuEl.style.left = left + 'px';
  }
  function openMenu(name, anchor, ctx) {
    closeMenus();
    var menuEl = menusRoot ? menusRoot.querySelector('[data-board-menu="' + name + '"]') : null;
    if (!menuEl) { return; }
    menuCtx = ctx || {};
    show(menuEl);
    positionAt(menuEl, anchor);
    openMenuEl = menuEl;
  }

  /* ================= FUNNEL CRUD ================= */
  function addFunnel() {
    // Add with a default name (no blocking prompt); the operator renames inline
    // on the fresh column via the pinned inline-rename affordance.
    req('POST', API + '/quotes/' + encodeURIComponent(quoteId) + '/funnels', { funnel_name: 'New funnel' }).then(function (res) {
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }
  function duplicateFunnel(pub) {
    req('POST', API + '/funnels/' + encodeURIComponent(pub) + '/duplicate', {}).then(function (res) {
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }
  function setDefaultFunnel(pub) {
    req('PUT', API + '/quotes/' + encodeURIComponent(quoteId) + '/default-funnel', { funnel_id: pub }).then(function (res) {
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }
  function moveFunnel(pub, dir) {
    var fs = orderedFunnels(); var idx = -1; var i;
    for (i = 0; i < fs.length; i++) { if (fs[i].public_id === pub) { idx = i; break; } }
    if (idx < 0) { return; }
    var to = dir === 'left' ? idx - 1 : idx + 1;
    if (to < 0 || to >= fs.length) { return; }
    var order = []; for (i = 0; i < fs.length; i++) { order.push(fs[i].public_id); }
    var tmp = order[idx]; order[idx] = order[to]; order[to] = tmp;
    req('PUT', API + '/quotes/' + encodeURIComponent(quoteId) + '/funnel-order', { order: order }).then(function (res) {
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }
  function renderGuard(blockers) {
    var guard = document.querySelector('[data-board-guard]');
    var bodyEl = document.querySelector('[data-board-guard-body]');
    if (!guard || !bodyEl) { return; }
    while (bodyEl.firstChild) { bodyEl.removeChild(bodyEl.firstChild); }
    var list = blockers && blockers.length ? blockers : ['This funnel can\\u2019t be deleted right now.'];
    var i;
    for (i = 0; i < list.length; i++) {
      var row = document.createElement('div');
      row.className = 'lg-guard-blocker';
      row.appendChild(document.createTextNode(list[i]));
      bodyEl.appendChild(row);
    }
    show(guard);
  }
  function closeGuard() { hide(document.querySelector('[data-board-guard]')); }
  function deleteFunnel(pub) {
    req('DELETE', API + '/funnels/' + encodeURIComponent(pub)).then(function (res) {
      if (res.status === 409 && res.body && res.body.blockers) { renderGuard(res.body.blockers); return; }
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }

  /* ===== FUNNEL SETTINGS DIALOG (relocated §8.2) ===== */
  // The single shared dialog rendered by renderFunnelSettingsDialog. On kebab
  // open it is re-populated from the clicked funnel's blob settings object and
  // its Save PUTs that funnel's ACTIVE variant through the EXISTING
  // /variants/:id fields. collectFunnelSettings carries ONLY the six scalar
  // fields (never pages/rules/sections) so this save can never wipe the money
  // path -- the field-present hardening collectPayload documents, dedicated path.
  var fsettingsEl = document.querySelector('[data-funnel-settings]');
  var fsettingsVariant = fsettingsEl ? (fsettingsEl.getAttribute('data-settings-variant') || '') : '';
  function fsById(id) { return document.getElementById(id); }
  function openFunnelSettings(pub) {
    if (!fsettingsEl) { return; }
    var f = funnelByPublic(pub);
    var s = f ? f.settings : null;
    if (!s || !s.variant_public_id) { showInlineErr(null, 'This funnel has no active variant to configure.'); return; }
    fsettingsVariant = s.variant_public_id;
    var en = fsById('lg-lander-enabled'); if (en) { en.checked = !!s.lander_enabled; }
    var hl = fsById('lg-lander-headline'); if (hl) { hl.value = s.lander_headline || ''; }
    var sub = fsById('lg-lander-sub'); if (sub) { sub.value = s.lander_subheadline || ''; }
    var hero = fsById('lg-lander-hero'); if (hero) { hero.value = s.lander_hero_media_url || ''; }
    var des = fsById('lg-funnel-design'); if (des) { des.value = s.funnel_design_id || ''; }
    var auc = fsById('lg-auction-id'); if (auc) { auc.value = (s.auction_id === null || s.auction_id === undefined) ? '' : String(s.auction_id); }
    show(fsettingsEl);
  }
  function closeFunnelSettings() { hide(fsettingsEl); }
  function collectFunnelSettings() {
    var payload = {};
    var en = fsById('lg-lander-enabled'); if (en) { payload.lander_enabled = en.checked; }
    var hl = fsById('lg-lander-headline'); if (hl) { payload.lander_headline = hl.value; }
    var sub = fsById('lg-lander-sub'); if (sub) { payload.lander_subheadline = sub.value; }
    var hero = fsById('lg-lander-hero'); if (hero) { payload.lander_hero_media_url = hero.value; }
    var des = fsById('lg-funnel-design'); if (des) { payload.funnel_design_id = des.value; }
    var auc = fsById('lg-auction-id'); if (auc) { payload.auction_id = auc.value ? Number(auc.value) : null; }
    return payload;
  }
  function saveFunnelSettings() {
    if (!fsettingsVariant) { showInlineErr(null, 'No funnel selected to save.'); return; }
    var btn = fsettingsEl ? fsettingsEl.querySelector('[data-funnel-settings-save]') : null;
    if (btn) { btn.disabled = true; }
    req('PUT', API + '/variants/' + encodeURIComponent(fsettingsVariant), collectFunnelSettings()).then(function (res) {
      if (btn) { btn.disabled = false; }
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }

  /* ================= INLINE RENAME ================= */
  function beginRename(nameEl, funnelPub) {
    if (nameEl.getAttribute('data-editing') === '1') { return; }
    nameEl.setAttribute('data-editing', '1');
    nameEl.className = nameEl.className.replace(/\\s*is-editing/g, '') + ' is-editing';
    nameEl.setAttribute('contenteditable', 'true');
    nameEl.focus();
    var original = nameEl.textContent;
    function finish(commit) {
      nameEl.removeAttribute('contenteditable');
      nameEl.setAttribute('data-editing', '0');
      nameEl.className = nameEl.className.replace(/\\s*is-editing/g, '');
      nameEl.removeEventListener('blur', onBlur);
      nameEl.removeEventListener('keydown', onKey);
      var next = nameEl.textContent.replace(/^\\s+|\\s+$/g, '');
      if (!commit || next === '' || next === original) { nameEl.textContent = original; return; }
      req('PATCH', API + '/funnels/' + encodeURIComponent(funnelPub), { funnel_name: next }).then(function (res) {
        if (!res.ok) { nameEl.textContent = original; showInlineErr(null, firstFieldError(res.body)); return; }
        reloadPage();
      });
    }
    function onBlur() { finish(true); }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    }
    nameEl.addEventListener('blur', onBlur);
    nameEl.addEventListener('keydown', onKey);
  }

  /* ============ SECTION PICKER (＋ section — the a11y/click add path) ======= */
  function openPopoverList(anchor, items, onPick) {
    closeMenus();
    var tm = document.querySelector('[data-template-menu]');
    if (!tm) { return; }
    while (tm.firstChild) { tm.removeChild(tm.firstChild); }
    if (items.length === 0) {
      var none = document.createElement('div'); none.className = 'lg-menu-item'; none.appendChild(document.createTextNode('Nothing available.')); tm.appendChild(none);
    }
    var i;
    for (i = 0; i < items.length; i++) {
      (function (it) {
        var el = document.createElement('div');
        el.className = 'lg-menu-item';
        el.setAttribute('role', 'menuitem');
        el.setAttribute('tabindex', '-1');
        el.appendChild(document.createTextNode(it.label));
        el.addEventListener('click', function (ev) { ev.stopPropagation(); closeMenus(); onPick(it.value); });
        tm.appendChild(el);
      }(items[i]));
    }
    show(tm);
    positionAt(tm, anchor);
    openMenuEl = tm;
  }
  function sectionItems() {
    var secs = BOARD.sections || []; var out = []; var i;
    for (i = 0; i < secs.length; i++) { out.push({ label: secs[i].name, value: secs[i].public_id }); }
    return out;
  }
  function templateItems() {
    var tpls = BOARD.templates || []; var out = []; var i;
    for (i = 0; i < tpls.length; i++) { out.push({ label: tpls[i].label, value: tpls[i].id }); }
    return out;
  }

  /* ================= TEMPLATE PICKER (M5 apply) ================= */
  function applyTemplate(funnelPub, templateId) {
    req('POST', API + '/funnels/' + encodeURIComponent(funnelPub) + '/apply-template', { template_id: templateId }).then(function (res) {
      if (!res.ok) { showInlineErr(null, firstFieldError(res.body)); return; }
      reloadPage();
    });
  }

  /* ============ PREVIEW (POST /variants/:id/preview -> new tab, Blob) ======= */
  function previewFunnel(funnel) {
    var variantPub = funnel.active_variant_public_id;
    if (!variantPub) { return; }
    var w = window.open('about:blank', '_blank');
    req('POST', API + '/variants/' + encodeURIComponent(variantPub) + '/preview', {}).then(function (res) {
      var html = (res.body && (res.body.html || res.body.preview_html)) || '';
      if (!res.ok || !html) { if (w) { w.close(); } showInlineErr(null, firstFieldError(res.body)); return; }
      var url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      if (w) { w.location = url; } else { window.open(url, '_blank'); }
    });
  }

  /* ================= tab jump (A/B badge, theme picker) ================= */
  function gotoTab(name) {
    var btn = document.querySelector('.lg-qtab[data-tab="' + name + '"]');
    if (btn) { btn.click(); }
  }

  /* ================= chip / page mutation helpers ================= */
  function funnelOfEl(el) {
    var col = el.closest ? el.closest('[data-funnel-col]') : null;
    if (!col) { return null; }
    return { pub: col.getAttribute('data-funnel-public-id'), model: funnelByPublic(col.getAttribute('data-funnel-public-id')), col: col };
  }
  function pageIndexOfEl(el) {
    var card = el.closest ? el.closest('[data-page-card]') : null;
    if (!card) { return -1; }
    return Number(card.getAttribute('data-page-index'));
  }
  function removeFunnelChip(chip) {
    var f = funnelOfEl(chip); if (!f || !f.model) { return; }
    var pi = pageIndexOfEl(chip); if (pi < 0) { return; }
    var slotId = Number(chip.getAttribute('data-slot-id'));
    var page = f.model.pages[pi]; if (!page) { return; }
    var kept = []; var i;
    for (i = 0; i < page.slots.length; i++) { if (page.slots[i].slot_id !== slotId) { kept.push(page.slots[i]); } }
    page.slots = kept;
    saveFunnel(f.model, chip);
  }
  function moveFunnelChip(chip, dir) {
    var f = funnelOfEl(chip); if (!f || !f.model) { return; }
    var pi = pageIndexOfEl(chip); if (pi < 0) { return; }
    var slotId = Number(chip.getAttribute('data-slot-id'));
    var page = f.model.pages[pi]; if (!page) { return; }
    var idx = -1; var i;
    for (i = 0; i < page.slots.length; i++) { if (page.slots[i].slot_id === slotId) { idx = i; break; } }
    var to = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || to < 0 || to >= page.slots.length) { return; }
    var tmp = page.slots[idx]; page.slots[idx] = page.slots[to]; page.slots[to] = tmp;
    saveFunnel(f.model, chip);
  }
  function removeSharedChip(chip) {
    var ids = (BOARD.shared_sections || []).slice();
    var pub = chip.getAttribute('data-section-public-id'); var out = []; var i;
    for (i = 0; i < ids.length; i++) { if (ids[i] !== pub) { out.push(ids[i]); } }
    saveShared(out, chip);
  }
  function moveSharedChip(chip, dir) {
    var ids = (BOARD.shared_sections || []).slice();
    var pub = chip.getAttribute('data-section-public-id');
    var idx = -1; var i; for (i = 0; i < ids.length; i++) { if (ids[i] === pub) { idx = i; break; } }
    var to = dir === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || to < 0 || to >= ids.length) { return; }
    var tmp = ids[idx]; ids[idx] = ids[to]; ids[to] = tmp;
    saveShared(ids, chip);
  }
  function movePage(pageCard, dir) {
    var f = funnelOfEl(pageCard); if (!f || !f.model) { return; }
    var pi = Number(pageCard.getAttribute('data-page-index'));
    var to = dir === 'up' ? pi - 1 : pi + 1;
    if (pi < 0 || to < 0 || to >= f.model.pages.length) { return; }
    var tmp = f.model.pages[pi]; f.model.pages[pi] = f.model.pages[to]; f.model.pages[to] = tmp;
    saveFunnel(f.model, pageCard);
  }
  function deletePage(pageCard) {
    var f = funnelOfEl(pageCard); if (!f || !f.model) { return; }
    var pi = Number(pageCard.getAttribute('data-page-index'));
    if (pi < 0 || pi >= f.model.pages.length) { return; }
    f.model.pages.splice(pi, 1);
    saveFunnel(f.model, pageCard);
  }
  function addPage(funnelCol) {
    var f = funnelOfEl(funnelCol); if (!f || !f.model) { return; }
    f.model.pages.push({ page_id: '', slots: [] });
    saveFunnel(f.model, funnelCol);
  }
  function addSectionToFunnelPage(funnelModel, pageIndex, sectionPublicId, nearEl) {
    var page = funnelModel.pages[pageIndex];
    if (!page) { funnelModel.pages.push({ page_id: '', slots: [] }); page = funnelModel.pages[funnelModel.pages.length - 1]; }
    page.slots.push({ slot_id: -1, kind: 'fixed', section_ids: [sectionPublicId], allocations: null, rules: null });
    saveFunnel(funnelModel, nearEl);
  }
  function addSectionToShared(sectionPublicId, nearEl) {
    var ids = (BOARD.shared_sections || []).slice();
    ids.push(sectionPublicId);
    saveShared(ids, nearEl);
  }

  /* ================= DRAG ENGINE (in-house mouse; both engines) ============= */
  var drag = null;
  function clearDropTargets() {
    var els = board.querySelectorAll('.lg-drop-target'); var i;
    for (i = 0; i < els.length; i++) { els[i].className = els[i].className.replace(/\\s*lg-drop-target/g, ''); }
  }
  function dropTargetUnder(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || !el.closest) { return null; }
    var pageCard = el.closest('[data-page-card]');
    var sharedCard = el.closest('[data-shared-page-card]');
    var funnelCol = el.closest('[data-funnel-col]');
    var sharedCol = el.closest('[data-shared-col]');
    if (sharedCard || sharedCol) { return { scope: 'shared', pageEl: sharedCard, colEl: sharedCol || (sharedCard ? sharedCard.closest('[data-shared-col]') : null) }; }
    if (pageCard) { return { scope: 'funnel', pageEl: pageCard, colEl: funnelCol }; }
    if (funnelCol) { return { scope: 'funnel', pageEl: null, colEl: funnelCol }; }
    return null;
  }
  function startDrag(kind, sourceEl, ev) {
    if (ev.button !== undefined && ev.button !== 0) { return; }
    ev.preventDefault();
    var nameEl = sourceEl.querySelector('.lg-sc-name') || sourceEl.querySelector('.lg-lc-name') || sourceEl.querySelector('.lg-page-num');
    drag = { kind: kind, el: sourceEl, startX: ev.clientX, startY: ev.clientY, moved: false, ghost: null, label: nameEl ? nameEl.textContent : 'Section' };
    document.addEventListener('mousemove', onDragMove, true);
    document.addEventListener('mouseup', onDragUp, true);
  }
  function ensureGhost() {
    if (drag.ghost) { return; }
    var g = document.createElement('div');
    g.className = 'lg-drag-ghost';
    g.appendChild(document.createTextNode(drag.label || 'Section'));
    document.body.appendChild(g);
    drag.ghost = g;
    if (drag.el.className.indexOf('lg-dragging') < 0) { drag.el.className = drag.el.className + ' lg-dragging'; }
  }
  function onDragMove(ev) {
    if (!drag) { return; }
    if (!drag.moved) {
      if (Math.abs(ev.clientX - drag.startX) < 5 && Math.abs(ev.clientY - drag.startY) < 5) { return; }
      drag.moved = true;
      ensureGhost();
    }
    if (drag.ghost) { drag.ghost.style.left = (ev.clientX + 8) + 'px'; drag.ghost.style.top = (ev.clientY + 8) + 'px'; }
    clearDropTargets();
    var t = dropTargetUnder(ev.clientX, ev.clientY);
    if (t) {
      var hi = t.pageEl || t.colEl;
      if (hi && hi.className.indexOf('lg-drop-target') < 0) { hi.className = hi.className + ' lg-drop-target'; }
    }
  }
  function endDrag() {
    document.removeEventListener('mousemove', onDragMove, true);
    document.removeEventListener('mouseup', onDragUp, true);
    if (drag && drag.ghost && drag.ghost.parentNode) { drag.ghost.parentNode.removeChild(drag.ghost); }
    if (drag && drag.el) { drag.el.className = drag.el.className.replace(/\\s*lg-dragging/g, ''); }
    clearDropTargets();
    drag = null;
  }
  function onDragUp(ev) {
    if (!drag) { return; }
    if (!drag.moved) { endDrag(); return; }
    var t = dropTargetUnder(ev.clientX, ev.clientY);
    var d = drag; endDrag();
    if (!t) { return; }
    if (d.kind === 'lib') {
      var pub = d.el.getAttribute('data-section-public-id');
      if (t.scope === 'shared') { addSectionToShared(pub, t.pageEl || t.colEl); return; }
      var f = funnelByPublic(t.colEl ? t.colEl.getAttribute('data-funnel-public-id') : '');
      if (!f) { return; }
      var pi = t.pageEl ? Number(t.pageEl.getAttribute('data-page-index')) : (f.pages.length - 1);
      addSectionToFunnelPage(f, pi, pub, t.pageEl || t.colEl);
      return;
    }
    if (d.kind === 'chip') {
      var srcScope = d.el.getAttribute('data-chip-scope');
      if (srcScope === 'shared') {
        if (t.scope !== 'shared') { showInlineErr(t.pageEl || t.colEl, 'Shared-page sections stay on the shared page.'); }
        return;
      }
      if (t.scope === 'shared') { showInlineErr(t.pageEl || t.colEl, 'Sections can\\u2019t move into the shared page \\u2014 drag from the library.'); return; }
      var srcF = funnelOfEl(d.el);
      var destPub = t.colEl ? t.colEl.getAttribute('data-funnel-public-id') : '';
      if (!srcF || !srcF.model || srcF.pub !== destPub) {
        showInlineErr(t.pageEl || t.colEl, 'Sections can\\u2019t move between funnels \\u2014 drag from the library instead.');
        return;
      }
      var srcPi = pageIndexOfEl(d.el); var slotId = Number(d.el.getAttribute('data-slot-id'));
      var destPi = t.pageEl ? Number(t.pageEl.getAttribute('data-page-index')) : srcPi;
      if (srcPi < 0) { return; }
      var srcPage = srcF.model.pages[srcPi]; var moved = null; var kept = []; var i;
      for (i = 0; i < srcPage.slots.length; i++) { if (srcPage.slots[i].slot_id === slotId) { moved = srcPage.slots[i]; } else { kept.push(srcPage.slots[i]); } }
      if (!moved) { return; }
      srcPage.slots = kept;
      var destPage = srcF.model.pages[destPi] || srcPage;
      destPage.slots.push(moved);
      saveFunnel(srcF.model, t.pageEl || t.colEl);
      return;
    }
    if (d.kind === 'page') {
      var pf = funnelOfEl(d.el); if (!pf || !pf.model) { return; }
      if (t.scope !== 'funnel' || !t.colEl || t.colEl.getAttribute('data-funnel-public-id') !== pf.pub) { return; }
      var from = Number(d.el.getAttribute('data-page-index'));
      var toIdx = t.pageEl ? Number(t.pageEl.getAttribute('data-page-index')) : (pf.model.pages.length - 1);
      if (from < 0 || toIdx < 0 || from === toIdx) { return; }
      var pg = pf.model.pages.splice(from, 1)[0];
      pf.model.pages.splice(toIdx, 0, pg);
      saveFunnel(pf.model, t.pageEl || t.colEl);
      return;
    }
  }

  /* ================= SEARCH + FILTER (client-side, no persist) ============== */
  var searchInput = document.querySelector('[data-lib-search]');
  var activeFilter = '';
  function applyLibFilter() {
    var q = (searchInput && searchInput.value ? searchInput.value : '').toLowerCase().replace(/^\\s+|\\s+$/g, '');
    var cards = document.querySelectorAll('[data-lib-card]'); var i;
    for (i = 0; i < cards.length; i++) {
      var name = (cards[i].getAttribute('data-section-name') || '').toLowerCase();
      var vert = cards[i].getAttribute('data-vertical-key') || '';
      var okQ = q === '' || name.indexOf(q) >= 0;
      var okF = activeFilter === '' || vert === activeFilter;
      cards[i].style.display = (okQ && okF) ? '' : 'none';
    }
  }
  if (searchInput) { searchInput.addEventListener('input', applyLibFilter); }

  /* ================= DELEGATED EVENTS ================= */
  (shell || document).addEventListener('mousedown', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-chip-kebab],[data-page-kebab],[data-funnel-kebab],[data-add-section],[data-add-shared-section],[data-add-page],[data-preview],[data-ab-badge],[data-theme-picker],[data-template-picker],[data-funnel-name],[data-lib-search],[data-lib-filter]')) { return; }
    var chipGrip = t.closest('[data-chip-grip]');
    if (chipGrip) { var chip = chipGrip.closest('[data-sec-chip]'); if (chip) { startDrag('chip', chip, ev); } return; }
    var pageGrip = t.closest('[data-page-grip]');
    if (pageGrip) { var pc = pageGrip.closest('[data-page-card]'); if (pc) { startDrag('page', pc, ev); } return; }
    var lib = t.closest('[data-lib-card]');
    if (lib) { startDrag('lib', lib, ev); return; }
  }, true);

  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) { return; }

    var actEl = t.closest('[data-menu-action]');
    if (actEl && openMenuEl && openMenuEl.contains(actEl)) {
      ev.stopPropagation();
      var action = actEl.getAttribute('data-menu-action');
      var ctx = menuCtx || {};
      closeMenus();
      dispatchMenuAction(action, ctx);
      return;
    }

    if (t.closest('[data-board-guard-close]')) { closeGuard(); return; }
    var guardEl = t.closest('[data-board-guard]');
    if (guardEl && t === guardEl) { closeGuard(); return; }

    // Relocated Funnel-settings dialog: Save / Cancel / backdrop-dismiss.
    if (t.closest('[data-funnel-settings-close]')) { ev.stopPropagation(); closeFunnelSettings(); return; }
    if (t.closest('[data-funnel-settings-save]')) { ev.stopPropagation(); saveFunnelSettings(); return; }
    var fsEl = t.closest('[data-funnel-settings]');
    if (fsEl && t === fsEl) { closeFunnelSettings(); return; }

    // §8.5 A/B tab: delete-variant (DELETE /variants/:id). Renders the server's
    // running-test / last-active-variant 409 message verbatim inline.
    var dv = t.closest('[data-delete-variant]');
    if (dv) {
      ev.stopPropagation();
      var vpub = dv.getAttribute('data-delete-variant');
      var vlabel = dv.getAttribute('data-variant-label') || 'this variant';
      var vErr = document.querySelector('[data-delete-variant-err="' + vpub + '"]');
      hide(vErr);
      if (!window.confirm('Delete variant ' + vlabel + '?')) { return; }
      req('DELETE', API + '/variants/' + encodeURIComponent(vpub)).then(function (res) {
        if (!res.ok) {
          if (vErr) { while (vErr.firstChild) { vErr.removeChild(vErr.firstChild); } vErr.appendChild(document.createTextNode(firstFieldError(res.body))); show(vErr); }
          return;
        }
        reloadPage();
      });
      return;
    }

    var fk = t.closest('[data-funnel-kebab]');
    if (fk) { ev.stopPropagation(); var fcol = fk.closest('[data-funnel-col]'); openMenu('funnel', fk, { funnelPub: fcol.getAttribute('data-funnel-public-id') }); return; }
    var ck = t.closest('[data-chip-kebab]');
    if (ck) { ev.stopPropagation(); var chip2 = ck.closest('[data-sec-chip]'); var which = ck.getAttribute('data-chip-menu'); openMenu(which, ck, { chip: chip2 }); return; }
    var pk = t.closest('[data-page-kebab]');
    if (pk) { ev.stopPropagation(); var pcard = pk.closest('[data-page-card]'); openMenu('page', pk, { pageCard: pcard }); return; }

    var addSec = t.closest('[data-add-section]');
    if (addSec) {
      ev.stopPropagation();
      var f2 = funnelOfEl(addSec); var pi2 = pageIndexOfEl(addSec);
      if (f2 && f2.model) { openPopoverList(addSec, sectionItems(), function (pub) { addSectionToFunnelPage(f2.model, pi2, pub, addSec); }); }
      return;
    }
    var addShared = t.closest('[data-add-shared-section]');
    if (addShared) { ev.stopPropagation(); openPopoverList(addShared, sectionItems(), function (pub) { addSectionToShared(pub, addShared); }); return; }
    var addPageEl = t.closest('[data-add-page]');
    if (addPageEl) { ev.stopPropagation(); addPage(addPageEl); return; }
    if (t.closest('[data-add-funnel]')) { ev.stopPropagation(); addFunnel(); return; }
    var pv = t.closest('[data-preview]');
    if (pv) { ev.stopPropagation(); var pf2 = funnelOfEl(pv); if (pf2 && pf2.model) { previewFunnel(pf2.model); } return; }
    if (t.closest('[data-ab-badge]')) { ev.stopPropagation(); gotoTab('ab'); return; }
    if (t.closest('[data-theme-picker]')) { ev.stopPropagation(); gotoTab('themes'); return; }
    var tp = t.closest('[data-template-picker]');
    if (tp) { ev.stopPropagation(); var tcol = tp.closest('[data-funnel-col]'); var tpub = tcol.getAttribute('data-funnel-public-id'); openPopoverList(tp, templateItems(), function (tid) { applyTemplate(tpub, tid); }); return; }
    var nm = t.closest('[data-funnel-name]');
    if (nm) { ev.stopPropagation(); var ncol = nm.closest('[data-funnel-col]'); beginRename(nm, ncol.getAttribute('data-funnel-public-id')); return; }
    var fp = t.closest('[data-lib-filter]');
    if (fp) {
      ev.stopPropagation();
      activeFilter = fp.getAttribute('data-lib-filter') || '';
      var pills = document.querySelectorAll('[data-lib-filter]'); var i;
      for (i = 0; i < pills.length; i++) { pills[i].className = pills[i].className.replace(/\\s*active/g, ''); }
      fp.className = fp.className + ' active';
      applyLibFilter();
      return;
    }
    if (openMenuEl && !openMenuEl.contains(t)) { closeMenus(); }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeMenus(); closeGuard(); closeFunnelSettings(); return; }
    if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
    var t = ev.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-add-funnel]')) { ev.preventDefault(); addFunnel(); return; }
    var lib = t.closest('[data-lib-card]');
    if (lib) {
      ev.preventDefault();
      var fs = orderedFunnels(); var target = null; var i;
      for (i = 0; i < fs.length; i++) { if (fs[i].is_default) { target = fs[i]; break; } }
      if (!target) { target = fs[0]; }
      if (target) { addSectionToFunnelPage(target, (target.pages.length - 1), lib.getAttribute('data-section-public-id'), lib); }
      return;
    }
  });

  function dispatchMenuAction(action, ctx) {
    if (action === 'duplicate') { duplicateFunnel(ctx.funnelPub); return; }
    if (action === 'set-default') { setDefaultFunnel(ctx.funnelPub); return; }
    if (action === 'move-left') { moveFunnel(ctx.funnelPub, 'left'); return; }
    if (action === 'move-right') { moveFunnel(ctx.funnelPub, 'right'); return; }
    if (action === 'delete') { deleteFunnel(ctx.funnelPub); return; }
    if (action === 'funnel-settings') { openFunnelSettings(ctx.funnelPub); return; }
    if (action === 'remove') {
      if (ctx.chip && ctx.chip.getAttribute('data-chip-scope') === 'shared') { removeSharedChip(ctx.chip); }
      else if (ctx.chip) { removeFunnelChip(ctx.chip); }
      return;
    }
    if (action === 'chip-up') { if (ctx.chip) { moveFunnelChip(ctx.chip, 'up'); } return; }
    if (action === 'chip-down') { if (ctx.chip) { moveFunnelChip(ctx.chip, 'down'); } return; }
    if (action === 'ab-slot') { gotoTab('ab'); return; }
    if (action === 'slot-rule') { gotoTab('ab'); return; }
    if (action === 'page-up') { if (ctx.pageCard) { movePage(ctx.pageCard, 'up'); } return; }
    if (action === 'page-down') { if (ctx.pageCard) { movePage(ctx.pageCard, 'down'); } return; }
    if (action === 'page-delete') { if (ctx.pageCard) { deletePage(ctx.pageCard); } return; }
  }

  window.addEventListener('resize', closeMenus);
  window.addEventListener('scroll', closeMenus, true);
}());
`;

