// LeadGen admin UI — Quotes editor, SHARED cross-tab module (LEADGEN-REWORK-03
// §12 P3a mechanical split of ui-quotes.ts). Holds: the structure/API-shape
// types every tab renders (StructureBody/VariantNode/PageNode/... — the
// /structure response shape), the persistent editor "chrome" rendered
// regardless of active tab (variant selector, preview-site selector, the
// publish/preflight-derived page data blob), the shared CSS, and the small
// generic form-widget builders (frameControl/frameSelect/mediaPickerControl/
// ...) reused across the Funnel builder / Templates / Themes tabs. Nothing in
// this file imports from a sibling quotes-tabs/* module — every tab module
// (and the ui-quotes.ts composer) imports FROM here, never the reverse, so
// P3b/P4's rewrites of the other tab modules cannot destabilize this one.
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).

import { escapeHtml } from "../../templates/layout";
import { resolveTokens, type Problem } from "../../../public/leadgen/designs/theme";
import { getFunnelDesign } from "../../../public/leadgen/designs/registry";
import { renderRulesBuilderPanel } from "../ui-rules-builder";


// ---------------------------------------------------------------------------
// API shapes (quotes-handlers.ts)
// ---------------------------------------------------------------------------

export interface QuoteListItem {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: string[];
  status: string;
  variant_count: number;
  active_sites_count: number;
  ab_status: string;
}


export interface RuleNode {
  id: number;
  public_id: string;
  rule_type: string;
  conditions_json: unknown;
  target_offer_id: number | null;
  target_section_id: number | null;
  redirect_url: string | null;
  redirect_url_allowlisted: boolean;
  priority: number;
  enabled: boolean;
  // Round-4 P4b rule-model v2 additive fields (quotes-handlers.ts ruleRowToApi
  // spreads these straight from the row; optional here so a stale/legacy
  // fixture without them still decodes — the unified builder defaults them).
  rule_name?: string | null;
  status?: string;
  match_mode?: string | null;
  target_funnel_variant_id?: number | null;
  value_multiplier?: number | null;
  checkpoint_page?: number | null;
  // §15.5 (0044, P4a fix round) — the redirect_direct_offer session-sticky
  // percentage gate.
  redirect_pct?: number | null;
}


export interface VariantSectionNode {
  position: number;
  section_id: number;
  section_public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  status: string;
  // DEV-59 ADDITIVE (quotes-handlers readVariantSections): the per-section
  // Offer-mapping verdict for the structure-panel dot. Optional so stale
  // structure bodies (pre-DEV-59) decode as "none".
  mapping_status?: "complete" | "incomplete" | "none";
}


export interface VariantNode {
  id: number;
  public_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  variant_label: string;
  traffic_allocation_bp: number;
  funnel_design_id: string;
  auction_id: number | null;
  lander_enabled: boolean;
  lander_headline: string | null;
  lander_subheadline: string | null;
  lander_hero_media_url: string | null;
  sections: VariantSectionNode[];
  rules: RuleNode[];
  auction_entry_position: number | null;
  // v2.5 §4.5 — the sparse per-arm frame/theme override patch (0041 column,
  // parsed by variantRowToApi; null on legacy rows).
  frame_overrides_json: Record<string, unknown> | null;
  // Rework M5 (§8.5 template A/B) — the arm's frame_template_id override
  // (NULL = inherit the funnel's). Rides the variantRowToApi `...row` spread;
  // optional so pre-M5 bodies decode.
  frame_template_id?: number | null;
  // Round-4 P3b — the FULL page/slot tree, sourced by the SSR editor via
  // loadVariantPages (buildPageNodes) and attached to the SELECTED variant
  // only (the structure panel renders one variant). Absent on the non-selected
  // arms and on the raw structure-endpoint projection.
  pages?: PageNode[];
}


// --- Round-4 P3b page/slot node model (structure panel) ----------------------
// A client-friendly projection of P3a's ResolvedFunnelPage: every raw-integer
// section_id in a slot's rules/allocations is resolved HERE (server-side, via
// the candidate order the loader returns) to its public_id + display name, so
// the ES5 island never sees a bare integer id nor has to re-derive the
// int→public mapping. A `fixed` slot carries one section ref; a `ruled` slot a
// list of cases (each an entry-known condition group → a section) plus a
// required default; an `ab` slot a list of {section, bp} allocations (Σbp ==
// 10000). slot_revision rides along so the A/B re-bucket note can surface it.
export interface SectionRef {
  section_id: string; // the section's public_id (what preparePages/resolveRef accepts)
  section_name: string;
  // The section's raw-integer DB id — ONLY set on a fixed slot's ref, where the
  // rendered .lg-section-row keeps its historical NUMERIC data-section-id (the
  // collectSections()/slideStillPresent() readers + the seam harness's
  // `data-section-id="(\d+)"` row regex both require digits).
  num_id?: number;
}

export interface AbEntryNode extends SectionRef {
  bp: number;
}

export interface RuledCaseNode extends SectionRef {
  conditions: { groups: unknown[] };
}

export interface PageSlotNode {
  slot_revision: number;
  kind: "fixed" | "ruled" | "ab";
  fixed: SectionRef | null;
  ab: AbEntryNode[] | null;
  ruled: { cases: RuledCaseNode[]; default_section: SectionRef } | null;
}

export interface PageNode {
  name: string | null;
  slots: PageSlotNode[];
}


export interface AbTestNode {
  id: number;
  public_id: string;
  funnel_id: number;
  name: string;
  revision: number;
  status: string;
  started_at: number | null;
  stopped_at: number | null;
}


// --- P3b (§8.2 board) additive projections -----------------------------------
// A funnel column renders the ACTIVE variant's PAGES as section-chip cards; the
// board reads the page tree (pageToApi shape) rather than the flat per-variant
// `sections` list. A slot is one chip; its candidates name it (fixed = one
// section; ab/ruled = the alternatives that slot resolves between).
export interface BoardPageSlot {
  slot_id: number;
  position: number;
  slot_revision: number;
  kind: "fixed" | "ab" | "ruled";
  rules: unknown;
  allocations: unknown;
  // mapping_status (DEV-59 parity, P3b follow-up): quoteStructureHandler's
  // attachMappingStatusToPages batch-attaches this per candidate; optional so
  // a stale/pre-attach body still decodes (the board renders "none" for it).
  candidates: Array<{ section_id: string; section_name: string; mapping_status?: "complete" | "incomplete" | "none" }>;
}

export interface BoardPage {
  page_id: string;
  position: number;
  name: string | null;
  slots: BoardPageSlot[];
}

// The quote-owned shared first page (sharedPageJson shape) — a single page with
// a FLAT ordered `sections` list (owner axis = quote_id, not variant_id).
export interface SharedPageSection {
  position: number;
  section_id: number;
  section_public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  status: string;
  mapping_status?: "complete" | "incomplete" | "none";
}

export interface SharedPageBody {
  page_id: string;
  position: number;
  name: string | null;
  sections: SharedPageSection[];
}


export interface FunnelNode {
  id: number;
  public_id: string;
  funnel_id: string;
  funnel_name: string;
  status: string;
  variants: VariantNode[];
  ab_tests: AbTestNode[];
  // P3b (§8.2 board) ADDITIVE — ride the funnelRowToApi `...row` spread + the
  // quoteStructureHandler board projection; optional so pre-P3b structure
  // bodies (and the flat variant-only callers) decode unchanged.
  display_order?: number | null;
  frame_template_id?: number | null;
  theme_json?: Record<string, unknown> | null;
  frame_config_json?: Record<string, unknown> | null;
  active_variant_public_id?: string | null;
  active_variant_pages?: BoardPage[];
}


export interface StructureBody {
  quote: {
    id: number;
    public_id: string;
    quote_id: string;
    quote_name: string;
    activity: string;
    verticals_json: string[];
    status: string;
    // P3b (§4.3-1/-7 board) — the quote's default funnel (numeric leadgen_funnels
    // .id; the board resolves it to a column by FunnelNode.id). Rides the
    // quoteRowToApi `...row` spread; optional for pre-M4 bodies.
    default_funnel_id?: number | null;
  };
  funnels: FunnelNode[];
  // P3b (§4.3-1/§8.2) — the quote-owned shared first page (or null).
  shared_page?: SharedPageBody | null;
}


export interface AvailableSection {
  id: number;
  public_id: string;
  section_name: string;
  activity: string;
  vertical: string;
  status: string;
  // Present on the sections list body (LeadgenSectionApi) — the B3 rules-
  // builder `fields` derivation reads component internal_fields from it.
  content_json?: unknown;
  // §9.3 list derivation (listSectionsHandler overallCompleteness) — DEV-59:
  // the add-picker threads it onto a freshly added row's mapping dot so a
  // client-side add shows REAL status without a reload.
  completeness?: "complete" | "incomplete" | "invalid" | "none";
}


export interface AuctionListItem {
  id: number;
  public_id: string;
  auction_name: string;
}


export interface ActivationSite {
  site_id: string;
  site_name: string;
  domain: string | null;
  activated: boolean;
  enabled: boolean;
  slug: string | null;
  preview_url: string;
}


// The 05 §5.2 (R5) activation-preflight verdict — additive on the activation
// GET, the variant PUT and the activation PUT; the EXACT normative report
// shape rides the activation 409 (quotes-handlers.computeQuoteActivationPreflight).
export interface ActivationPreflightBlock {
  section_id: string;
  section_name: string;
  offer_id: string;
  offer_name: string;
  code: string;
  fields: string[];
  fix_links: { section_mapping?: string; offer_schema?: string };
}


export interface ActivationPreflight {
  ok: boolean;
  quote_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  blocks: ActivationPreflightBlock[];
  computed_at: number;
  // v2.5 14 §14.1 — the additive §3.6 problems projection (frame/theme/
  // branding/chrome rows). Optional: pre-v2.5 stored verdicts lack it.
  problems?: Problem[];
}


export interface ActivationBody {
  quote_id: string;
  sites: ActivationSite[];
  activation_preflight?: ActivationPreflight | null;
}


// --- v2.5 04 §4.8 bodies the studio SSR embeds (frame-handlers.ts) ----------

export interface FrameGetBody {
  frame_config: Record<string, unknown> | null;
  effective_frame: Record<string, unknown>;
  template_defaults: Record<string, unknown>;
  problems: Problem[];
}


export interface ThemeGetBody {
  theme: Record<string, unknown> | null;
  effective_tokens: Record<string, string>;
  problems: Problem[];
}


export interface FrameTemplateItem {
  id: string;
  label: string;
  arrangement: string;
  thumbnail_html: string;
  defaults: Record<string, unknown>;
}


export interface OfferListItem {
  id: number;
  public_id: string;
  offer_name: string;
}


// The §10.5 site-selector option: ALL CMS sites + the status badge derived
// from this quote's leadgen_site_quotes rows (the activation GET the page
// already queries — no new SQL).
export interface PreviewSiteOption {
  site_id: string;
  site_name: string;
  badge: "Active" | "Activation off" | "Not activated yet";
}


export function previewSiteOptions(activation: ActivationBody | null): PreviewSiteOption[] {
  const sites = activation?.sites ?? [];
  const options = sites.map((s): PreviewSiteOption => ({
    site_id: s.site_id,
    site_name: s.site_name,
    badge: s.enabled ? "Active" : s.activated ? "Activation off" : "Not activated yet",
  }));
  // §10.5: activated sites list first.
  return options.sort((a, b) => {
    const rank = (o: PreviewSiteOption): number => (o.badge === "Active" ? 0 : o.badge === "Activation off" ? 1 : 2);
    return rank(a) - rank(b) || a.site_name.localeCompare(b.site_name);
  });
}


// ---------------------------------------------------------------------------
// 05 §5.2 preflight rendering (SSR + the ES5 re-renderer share these maps)
// ---------------------------------------------------------------------------

// Operator-English labels for every block code computeVariantPreflightBlocks /
// computeQuoteActivationPreflight emits. The normative copy pattern is
// "<label>: <fields…>" — e.g. "Missing required provider fields:
// current_insurance.carrier". offer_ineligible fields are §5.1 reason CODES
// and map through LEADGEN_ELIGIBILITY_REASON_LABELS instead of rendering raw.
export const PREFLIGHT_BLOCK_CODE_LABELS: Readonly<Record<string, string>> = {
  missing_required_provider_fields: "Missing required provider fields",
  orphaned_provider_fields: "Mapped provider fields no longer exist in the active payload schema",
  type_conversion_invalid: "Answer type conversion is invalid for provider fields",
  payload_schema_version_missing: "The selected offer has no active payload schema version",
  dependency_missing_field: "A visibility condition references a missing field",
  mapping_incomplete: "Offer mapping is incomplete",
  auction_config_invalid: "Auction configuration is invalid",
  offer_ineligible: "Participating offer is not eligible for live auction",
};


// ---------------------------------------------------------------------------
// v2.5 14 §14.2 (C2 LIVE, Phase D) — Activation-tab problems[] surfacing: the
// additive §3.6 rows render GROUPED BY SCOPE with severity chips and each
// problem's server-provided fix_url as a deep link. Blocking semantics mirror
// the activation PUT: blocks OR any error-severity problem ⇒ blocked;
// warnings never block. The ES5 re-renderer mirrors this markup exactly.
// ---------------------------------------------------------------------------

export const PROBLEM_SCOPE_ORDER: ReadonlyArray<string> = [
  "frame",
  "theme",
  "section",
  "component",
  "choice",
  "mapping",
];


export const PROBLEM_SCOPE_LABELS: Readonly<Record<string, string>> = {
  frame: "Funnel layout",
  theme: "Theme",
  section: "Slides",
  component: "Components",
  choice: "Choices",
  mapping: "Offer mapping",
};


// The PASS state renders green itemized checks — the §5.2 block conditions,
// inverted (each one verified clean by the server verdict).
export const PREFLIGHT_PASS_CHECKS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "section_mappings_complete", label: "Selected-offer mappings complete for every active section" },
  { id: "required_provider_fields_mapped", label: "All required provider fields mapped" },
  { id: "no_orphaned_provider_fields", label: "No mapped provider fields missing from active schemas" },
  { id: "type_conversions_valid", label: "All answer-to-provider type conversions valid" },
  { id: "payload_schema_versions_present", label: "Every selected dynamic offer has an active payload schema version" },
  { id: "dependencies_resolve", label: "All visibility conditions reference existing fields" },
  { id: "auction_config_valid", label: "Auction configuration valid" },
  { id: "participating_offers_eligible", label: "All participating dynamic offers eligible for live auction" },
];


// ---------------------------------------------------------------------------
// v2.5 09 §9.1 — semantic role metadata (label + "Used by", verbatim from the
// contract table). The ONLY color vocabulary on normal surfaces; the island
// paints swatches from `effective_tokens` — no hex is ever SSR'd as text.
// ---------------------------------------------------------------------------

export const ROLE_META: ReadonlyArray<{ role: string; label: string; used_by: string }> = [
  { role: "brand_primary", label: "Brand primary", used_by: "buttons, progress fill, selected borders, logo text" },
  { role: "brand_secondary", label: "Brand secondary", used_by: "gradients, secondary emphasis" },
  { role: "accent", label: "Accent", used_by: "category label, highlights, recommended" },
  { role: "success", label: "Success", used_by: "reassurance, valid states" },
  { role: "error", label: "Error", used_by: "validation errors" },
  { role: "page_background", label: "Page background", used_by: "frame background" },
  { role: "card_background", label: "Card background", used_by: "question card, answer cards" },
  { role: "surface_wash", label: "Soft fill", used_by: "selected fills, quiet panels" },
  { role: "border", label: "Border", used_by: "card/input borders" },
  { role: "text_primary", label: "Text", used_by: "headlines, labels" },
  { role: "text_muted", label: "Muted text", used_by: "subheadlines, helper, meta" },
  { role: "button_primary_bg", label: "Button", used_by: "Continue/CTA background" },
  { role: "button_primary_text", label: "Button text", used_by: "Continue/CTA text" },
  { role: "button_secondary_bg", label: "Secondary button", used_by: "back button-style, quiet buttons" },
];


export function roleLabel(role: string): string {
  return ROLE_META.find((r) => r.role === role)?.label ?? role.replace(/_/g, " ");
}


// The §4.1 clickable frame regions → operator labels (data-frame-region
// values stamped by renderQuoteFrame; `logo` clicks land on the Header
// inspector — the logo is header config).
// DEV-60 (a) — the curated benefit-bar icon vocabulary (04 §4.4 "icon
// picker"). The runtime preset (renderTrustBar via renderBenefitRegion)
// renders the icon STRING verbatim as a glyph — the design system's own
// defaults are the "✓" and "🔒" glyphs (components/presets.ts), so the closed
// list is a glyph set, not free text. Stored legacy values outside this list
// are PRESERVED by the island (appended as a "(stored)" option on populate).
export const BENEFIT_BAR_ICONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "✓", label: "Check" },
  { value: "★", label: "Star" },
  { value: "\u{1F512}", label: "Lock" },
  { value: "\u{1F6E1}", label: "Shield" },
  { value: "⏱", label: "Clock" },
  { value: "\u{1F4B2}", label: "Dollar" },
  { value: "❤", label: "Heart" },
  { value: "☎", label: "Phone" },
];


export const FRAME_REGION_LABELS: Readonly<Record<string, string>> = {
  header: "Header",
  progress: "Progress",
  back: "Back",
  disclosure: "Disclosure",
  footer: "Footer",
  trust_strip: "Trust strip",
  benefit_bar: "Benefit bar",
  background: "Background",
  section_slot: "Section slot",
};


// §4.5 override-group labels (the switchable inspector groups + theme).
export const OVERRIDE_GROUP_LABELS: Readonly<Record<string, string>> = {
  ...FRAME_REGION_LABELS,
  mobile: "Mobile behavior",
  theme: "Theme colors",
};


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const LG_QUOTES_STYLES = `
.lg-editor-head{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.lg-editor-title{margin:0;font-size:20px}
.lg-editor-pubid{color:var(--c-muted);font-size:12px}
.lg-editor-spacer{flex:1}
.lg-qtabs{display:flex;gap:4px;margin:12px 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-qtab{padding:8px 14px;color:var(--c-muted);font-weight:500;border-bottom:2px solid transparent;margin-bottom:-1px;background:none;border-top:none;border-left:none;border-right:none;cursor:pointer}
.lg-qtab.active{color:var(--c-primary);border-bottom-color:var(--c-primary)}
.lg-qpanel{display:none}
.lg-qpanel.active{display:block}
.lg-scalars{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (max-width:640px){.lg-scalars{grid-template-columns:1fr}}
.lg-section-row{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px}
.lg-section-row .lg-grow{flex:1}
.lg-auction-entry-mark{background:var(--c-warn-bg,#fff4e5);color:var(--c-warn,#8a5300);border:1px dashed var(--c-warn,#e0a04a);border-radius:6px;padding:8px;margin:6px 0;font-size:13px}
.lg-rule-row{border:1px solid var(--c-border);border-radius:6px;padding:10px;margin-bottom:8px}
.lg-rule-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
@media (max-width:640px){.lg-rule-grid{grid-template-columns:1fr}}
.lg-activation-row{display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-preflight-blocked-title{font-weight:600;color:var(--c-danger,#8a1f11);margin:0 0 8px}
.lg-preflight-ok-title{font-weight:600;color:var(--c-success,#186a3b);margin:0 0 8px}
.lg-preflight-block{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--c-danger-bg,#fdecea);color:var(--c-danger,#8a1f11);border:1px solid var(--c-danger,#e5a49a);border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px}
.lg-preflight-pass{list-style:none;margin:0;padding:0}
.lg-preflight-pass li{color:var(--c-success,#186a3b);font-size:13px;padding:3px 0}
/* 14 §14.2 problems[] groups (C2 LIVE): scope groups + severity chips */
.lg-problem-group{margin:10px 0}
.lg-problem-group-title{margin:0 0 6px;font-size:13px}
.lg-problem-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--c-border);border-radius:6px;padding:8px 10px;margin-bottom:6px;font-size:13px}
.lg-problem-row[data-problem-severity=error]{background:var(--c-danger-bg,#fdecea);border-color:var(--c-danger,#e5a49a);color:var(--c-danger,#8a1f11)}
.lg-problem-row[data-problem-severity=warning]{background:#fff8e1;border-color:#e6c229;color:#664d03}
.lg-problem-chip{border-radius:999px;padding:0 8px;font-size:11px;font-weight:600;border:1px solid currentColor;text-transform:uppercase;letter-spacing:.02em}
.lg-problem-msg{flex:1;min-width:200px}
.lg-preview-frame{width:100%;height:640px;border:1px solid var(--c-border);border-radius:8px;background:#fff}
.lg-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
/* --- v2.5 04 §4.1 frame studio ------------------------------------------- */
.lg-studio{display:grid;grid-template-columns:260px minmax(0,1fr) 320px;gap:12px;align-items:start}
@media (max-width:1100px){.lg-studio{grid-template-columns:1fr}}
.lg-studio-left{display:flex;flex-direction:column;gap:12px}
.lg-canvas-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;border:1px solid var(--c-border);border-radius:8px;margin-bottom:8px}
.lg-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--c-border);border-radius:999px;padding:2px 10px;font-size:12px;color:var(--c-muted);background:var(--c-bg,#f6f7f9)}
.lg-chip strong{color:var(--c-text)}
.lg-publish-chip[data-publish-verdict=blocked]{background:var(--c-danger-bg,#fdecea);color:var(--c-danger,#8a1f11);border-color:var(--c-danger,#e5a49a)}
.lg-publish-chip[data-publish-verdict=ok]{background:var(--c-success-bg,#e9f7ef);color:var(--c-success,#186a3b);border-color:var(--c-success,#a9dfbf)}
.lg-scope-head{font-size:12px;color:var(--c-muted);border-bottom:1px solid var(--c-border);padding-bottom:6px;margin-bottom:8px}
.lg-scope-head strong{color:var(--c-text)}
.lg-scope-chip{display:inline-block;border:1px solid var(--c-border);border-radius:999px;padding:0 8px;font-size:11px;margin-left:6px;color:var(--c-muted)}
.lg-inspector-panel{display:none}
.lg-inspector-panel.active{display:block}
.lg-inspector-panel .form-group{margin-bottom:10px}
.lg-region-note{color:var(--c-muted);font-size:12px;margin:6px 0 0}
/* Round-4 P5b (Image15 ruling): aligned rows, the mark RIGHT of the label —
   see renderProgressInspector's doc comment. Flexbox lays out EVERY direct
   child (incl. a block-level .lg-tpl-band thumbnail span) in a single row
   regardless of the child's own display type, which is what kills the old
   orphaned-circle-above-bar wrap. */
.lg-progress-style-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;cursor:pointer}
.lg-progress-style-label{white-space:nowrap}
.lg-advanced{border:1px dashed var(--c-border);border-radius:6px;padding:6px 10px;margin-top:10px}
.lg-advanced summary{cursor:pointer;color:var(--c-muted);font-size:12px}
.lg-role-strip{display:flex;flex-wrap:wrap;gap:4px}
.lg-role-swatch{width:22px;height:22px;border-radius:6px;border:1px solid var(--c-border);cursor:pointer;padding:0}
.lg-role-swatch.selected{outline:2px solid var(--c-primary);outline-offset:1px}
.lg-slot-banner{background:var(--c-warn-bg,#fff4e5);border:1px solid var(--c-warn,#e0a04a);border-radius:6px;padding:10px 12px;margin:8px 0;font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.lg-structure-row{display:flex;align-items:center;gap:6px;padding:6px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px}
.lg-structure-row .lg-grow{flex:1;min-width:0}
.lg-structure-row button[data-select-slide]{background:none;border:0;padding:0;cursor:pointer;color:var(--c-text);text-align:left;font:inherit}
.lg-structure-row.lg-slide-current{border-color:var(--c-primary)}
/* --- Round-4 P3b: pages-first structure panel (fixes 10J/Image41) ----------
   ONE grid/stack model for the section rows replaces the old .lg-section-row
   / .lg-structure-row flex SPLIT that wrapped and crowded at the 260px rail.
   Arm rows (plain .lg-structure-row) keep the flex layout; a row carrying
   BOTH .lg-section-row and .lg-structure-row switches to the stacked layout.
   (§10/S5.1: the identity-line classes this rule once stacked — drag handle/
   position dot/ellipsizing name cell — and the sibling .lg-slot-row variant
   of this same compound rule were deleted as confirmed dead; only the
   .lg-section-row.lg-structure-row combination above still ships.) */
.lg-page{border:1px solid var(--c-border);border-radius:8px;padding:8px;margin-bottom:10px;background:var(--c-bg,#f6f7f9)}
.lg-page-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;min-width:0}
.lg-page-num{font-variant-numeric:tabular-nums;font-weight:600;font-size:12px;background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:999px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.lg-slot{background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:6px;overflow:hidden}
.lg-section-row.lg-structure-row{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:6px;margin-bottom:0;border:0;border-radius:0;min-width:0}
.lg-row-rail{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:4px}
.lg-row-rail .btn{flex:none}
.lg-ab-cand,.lg-ruled-case{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.lg-ab-cand .lg-grow,.lg-ruled-case .lg-grow{flex:1;min-width:80px}
.form-select-sm,.form-input-sm{padding:2px 6px;font-size:12px;height:auto;min-height:0}
.lg-map-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:var(--c-border);flex:none}
/* DEV-59 real tri-state: green complete · amber incomplete · gray none */
.lg-map-dot[data-mapping-status="complete"]{background:#198754}
.lg-map-dot[data-mapping-status="incomplete"]{background:#ffc107}
.lg-map-dot[data-mapping-status="none"]{background:var(--c-border)}
.lg-tpl-thumb{display:flex;flex-direction:column;gap:3px;padding:6px;border-radius:6px;background:var(--c-bg,#f6f7f9);min-height:64px;justify-content:center}
.lg-tpl-band{display:block;height:6px;border-radius:3px;background:var(--c-border)}
.lg-tpl-logo{width:40%;margin:0 auto}
.lg-tpl-logo--left{margin:0}
.lg-tpl-progress{background:var(--c-primary);opacity:.5}
.lg-tpl-slot{height:22px;background:#fff;border:1px solid var(--c-border)}
.lg-tpl-slot--bare{background:none;border-style:dashed}
.lg-tpl-thumb--bg-brand,.lg-tpl-thumb--bg-brand_gradient{background:var(--c-primary);opacity:.85}
.lg-theme-role-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--c-border);flex-wrap:wrap}
.lg-theme-role-row .lg-grow{flex:1;min-width:180px}
.lg-theme-swatch{width:28px;height:28px;border-radius:6px;border:1px solid var(--c-border);flex:none}
.lg-used-by{color:var(--c-muted);font-size:12px}
.lg-inherit-tag{font-size:11px;border:1px solid var(--c-border);border-radius:999px;padding:0 8px;color:var(--c-muted)}
.lg-harmony-row{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0}
.lg-harmony-step{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--c-border);border-radius:6px;background:none;cursor:pointer;padding:4px 8px;font-size:12px;color:var(--c-text)}
.lg-harmony-chip{width:14px;height:14px;border-radius:4px;border:1px solid var(--c-border);display:inline-block}
.lg-media-field{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
.lg-media-thumb{width:40px;height:30px;object-fit:contain;border:1px solid var(--c-border);border-radius:4px;background:#fff}
.lg-media-picker-overlay{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px}
.lg-media-picker-panel{background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:10px;max-width:720px;width:100%;max-height:80vh;overflow:auto;padding:16px}
.lg-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:10px}
.lg-media-item{border:1px solid var(--c-border);border-radius:8px;background:none;cursor:pointer;padding:6px;display:flex;flex-direction:column;gap:4px;align-items:center}
.lg-media-item img{max-width:100%;height:64px;object-fit:contain}
.lg-media-item span{font-size:11px;color:var(--c-muted);word-break:break-all}
.lg-section-row.lg-drag-over{outline:2px dashed var(--c-primary,#2563eb);outline-offset:-2px}
.lg-rename-editor{display:inline-flex;gap:6px;align-items:center}
.lg-list-row{display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap}
.lg-list-row .form-input{flex:1;min-width:90px}
.lg-override-switch{display:flex;gap:12px;align-items:center;border:1px dashed var(--c-border);border-radius:6px;padding:6px 10px;margin-bottom:10px;font-size:12px;flex-wrap:wrap}
.lg-override-badge{position:sticky;top:0;z-index:2}
.lg-step-controls{display:inline-flex;align-items:center;gap:6px}
.lg-panel-card{border:1px solid var(--c-border);border-radius:8px;padding:12px;background:var(--c-card,#fff)}
.lg-panel-card h3{margin:0 0 8px;font-size:14px}
.lg-panel-card h4{margin:14px 0 8px;font-size:13px}
/* --- Round-4 P5b: Templates-tab per-element dynamic-list styles ------------ */
.lg-tplbox-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-bottom:12px}
.lg-tplbox-card{display:flex;flex-direction:column;align-items:center;gap:4px;border:1px solid var(--c-border);border-radius:8px;padding:10px 8px;cursor:pointer;background:none;text-align:center}
.lg-tplbox-card.selected{border-color:var(--c-primary)}
.lg-tplbox-card-letter{width:26px;height:26px;border-radius:50%;background:var(--c-bg,#f6f7f9);border:1px solid var(--c-border);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.lg-tplbox-editor{border-top:1px solid var(--c-border);padding-top:12px}
.lg-tplbox-row{border:1px solid var(--c-border);border-radius:6px;padding:8px;margin-bottom:8px}
.lg-tplbox-cond{border-top:1px dashed var(--c-border);margin-top:8px;padding-top:8px}
.lg-tplbox-block{border:1px dashed var(--c-border);border-radius:6px;padding:8px;margin:6px 0}
.lg-tplbox-toolbar{display:flex;gap:4px;margin-bottom:6px}
.lg-tplbox-pagetarget{border-top:1px dashed var(--c-border);margin-top:8px;padding-top:8px}
.lg-tplbox-persona{border-top:1px dashed var(--c-border);margin-top:8px;padding-top:8px}
.lg-hidden{display:none}
/* --- P6b: Themes-tab presets (apply picker + embedded theme-manager) ------- */
.lg-preset-apply-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0}
.lg-preset-apply-row select{flex:1 1 220px;min-width:160px}
.lg-theme-presets-frame{display:block;width:100%;height:820px;border:1px solid var(--c-border);border-radius:8px;margin-top:10px}
/* === P3b (§8.2) — Funnel-builder BOARD ==================================== */
/* Geometry pinned to docs/leadgen/rework/design-pack/board.html: 292px left
   library rail / fluid center board (h-scroll INSIDE .lg-board only) / 344px
   right routing-rules mount. navy = --c-primary (#1B3A5C golden master). */
.lg-board-shell{display:flex;min-height:620px;border:1px solid var(--c-border);border-radius:10px;overflow:hidden;background:#EDF0F4;align-items:stretch}
.lg-board-left{flex:0 0 292px;width:292px;background:#fff;border-right:1px solid var(--c-border);display:flex;flex-direction:column;min-height:0}
.lg-board-center{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;min-height:0}
.lg-board-right{flex:0 0 344px;width:344px;background:#fff;border-left:1px solid var(--c-border);display:flex;flex-direction:column;min-height:0;overflow-y:auto}
/* the board is the ONLY horizontal scroller (AC: board h-scroll internal) */
.lg-board{flex:1 1 auto;min-height:0;overflow:auto;padding:16px}
.lg-board-cols{display:flex;gap:14px;align-items:flex-start;min-height:100%}
.lg-col{flex:0 0 288px;width:288px;background:#F7F9FB;border:1px solid var(--c-border);border-radius:12px;display:flex;flex-direction:column;max-height:560px}
.lg-col-shared{position:sticky;left:0;z-index:3;background:#fff;border:1.5px solid #C7D6E6;box-shadow:6px 0 14px -8px rgba(20,32,54,.18)}
.lg-col-funnel.is-default{border-color:var(--c-primary)}
.lg-col-funnel.lg-drop-target,.lg-page-card.lg-drop-target,.lg-col-shared.lg-drop-target{outline:2px dashed var(--c-primary,#1B3A5C);outline-offset:-2px;background:#EAF0F6}
.lg-col-head{flex:0 0 auto;padding:12px;border-bottom:1px solid var(--c-border)}
.lg-col-shared .lg-col-head{background:#EAF0F6;border-radius:11px 11px 0 0}
.lg-col-tag{display:inline-flex;align-items:center;gap:5px;font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--c-primary,#1B3A5C);margin-bottom:6px}
.lg-col-title-row{display:flex;align-items:center;gap:8px}
.lg-col-title{font-size:14px;font-weight:800;color:var(--c-text);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border-bottom:1.5px dashed transparent;padding:1px 2px;cursor:text}
.lg-col-title.is-editing{border-bottom-color:var(--c-primary);white-space:normal;overflow:visible}
.lg-col-help{font-size:11.5px;color:#8A93A3;line-height:1.45}
.lg-col-meta{display:flex;align-items:center;gap:6px;margin-top:9px;flex-wrap:wrap}
.lg-col-actions{display:flex;align-items:center;gap:8px;margin-top:10px}
.lg-col-body{flex:1 1 auto;overflow-y:auto;padding:12px}
.lg-pickchip{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--c-text);background:#fff;border:1px solid var(--c-border);border-radius:7px;padding:4px 8px;cursor:pointer}
.lg-badge-default{position:relative;display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#fff;background:var(--c-primary,#1B3A5C);padding:2px 8px;border-radius:20px;cursor:default}
.lg-badge-default .lg-tip{display:none;position:absolute;top:calc(100% + 6px);left:0;z-index:20;background:#111726;color:#fff;font-size:11.5px;font-weight:500;letter-spacing:0;text-transform:none;line-height:1.4;padding:7px 10px;border-radius:7px;width:200px;box-shadow:0 6px 18px rgba(20,32,54,.28)}
.lg-badge-default:hover .lg-tip,.lg-badge-default:focus .lg-tip,.lg-badge-default:focus-within .lg-tip{display:block}
.lg-badge-ab{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;color:#fff;background:#2E6BB0;padding:2px 8px;border-radius:6px;cursor:pointer;border:0}
.lg-col-preview{display:inline-flex;align-items:center;gap:5px;margin-left:auto;padding:5px 10px;font-size:12px;font-weight:600;color:var(--c-muted);background:#fff;border:1px solid var(--c-border);border-radius:8px;cursor:pointer}
.lg-page-card{background:#fff;border:1px solid #E9EDF3;border-radius:10px;padding:10px 11px 12px;margin-bottom:10px;position:relative}
.lg-page-card.lg-dragging{box-shadow:0 14px 30px rgba(20,32,54,.20);opacity:.9;border-color:var(--c-primary)}
.lg-page-head{display:flex;align-items:center;gap:8px;margin-bottom:9px}
.lg-page-num{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8A93A3;flex:1 1 auto}
.lg-chip-list{display:flex;flex-direction:column}
.lg-sec-chip{display:flex;align-items:center;gap:7px;background:#EAF0F6;border:1px solid #C7D6E6;border-radius:8px;padding:7px 8px;margin-bottom:6px}
.lg-sec-chip.lg-dragging{opacity:.6}
.lg-sec-chip .lg-sc-name{font-size:12.5px;font-weight:600;color:var(--c-primary,#1B3A5C);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-chip-grip,.lg-page-grip{cursor:grab;color:#5E799B;flex:0 0 auto;display:inline-flex}
.lg-chip-kebab,.lg-page-kebab{cursor:pointer;flex:0 0 auto;color:#5E799B;display:inline-flex;padding:1px;border-radius:4px}
.lg-add-section{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--c-primary,#1B3A5C);cursor:pointer;padding:6px 4px 2px}
.lg-add-page{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px;border:1px dashed #D5DCE6;border-radius:10px;color:var(--c-muted);font-size:12.5px;font-weight:600;cursor:pointer;background:#fff}
.lg-empty-col-body{flex:1 1 auto;display:flex;flex-direction:column;gap:12px;padding:16px}
.lg-empty-hint{border:1.5px dashed #D5DCE6;border-radius:10px;padding:20px 14px;text-align:center;font-size:12.5px;color:#78818F;line-height:1.5}
.lg-hint-neutral{display:block;background:#F6F8FB;border-radius:8px;padding:10px 12px;font-size:11.5px;color:#7C889A;line-height:1.45;margin-top:2px}
.lg-stub-col{flex:0 0 250px;width:250px;align-self:stretch;min-height:220px;border:1.5px dashed #D5DCE6;border-radius:12px;background:rgba(255,255,255,.5);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;padding:20px;cursor:pointer;text-align:center}
.lg-plus-ring{width:40px;height:40px;border-radius:50%;background:#EAF0F6;display:inline-flex;align-items:center;justify-content:center;color:var(--c-primary,#1B3A5C)}
.lg-stub-title{font-size:14px;font-weight:800;color:var(--c-primary,#1B3A5C)}
.lg-stub-sub{font-size:11.5px;color:#8A93A3;line-height:1.45;max-width:180px}
/* left library */
.lg-lib-head{flex:0 0 auto;padding:15px 16px 10px}
.lg-lib-title{font-size:13px;font-weight:800;color:var(--c-text);margin-bottom:11px}
.lg-lib-search{position:relative;margin-bottom:10px}
.lg-lib-search input{width:100%;padding:9px 12px 9px 34px;font-size:13px;border:1px solid var(--c-border);border-radius:8px;outline:none;background:#F8FAFC;font-family:inherit;color:var(--c-text)}
.lg-lib-search-ico{position:absolute;left:11px;top:50%;transform:translateY(-50%);color:#9AA3B2;display:inline-flex}
.lg-lib-filters{display:flex;gap:6px;flex-wrap:wrap}
.lg-filter-pill{display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;color:var(--c-muted);background:#fff;border:1px solid var(--c-border);border-radius:20px;padding:5px 10px;cursor:pointer}
.lg-filter-pill.active{color:var(--c-primary,#1B3A5C);background:#EAF0F6;border-color:#C7D6E6;font-weight:700}
.lg-lib-list{flex:1 1 auto;overflow-y:auto;padding:4px 16px 18px}
.lg-lib-card{display:block;width:100%;padding:11px 12px;border:1px solid var(--c-border);border-radius:9px;background:#fff;cursor:grab;margin-bottom:8px;position:relative;text-align:left}
.lg-lib-card:hover{border-color:var(--c-primary);background:#F7F9FC;box-shadow:0 2px 6px rgba(16,24,40,.07)}
.lg-lib-card.in-current{opacity:.72}
.lg-lib-card.lg-dragging{opacity:.5}
.lg-lc-top{display:flex;align-items:center;gap:8px}
.lg-lc-name{font-size:13px;font-weight:700;color:var(--c-text);flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-lc-meta{display:flex;align-items:center;gap:6px;margin-top:7px;flex-wrap:wrap;padding-left:20px}
.lg-chip-activity{display:inline-flex;align-items:center;font-size:11px;font-weight:600;color:#8A93A3;background:#F3F5F8;border-radius:20px;padding:3px 9px}
.lg-chip-inuse{display:inline-flex;align-items:center;font-size:9.5px;letter-spacing:.3px;padding:2px 7px;font-weight:700;color:#98A1B0;background:#EEF1F6;border-radius:20px}
.lg-chip-inuse-here{display:inline-flex;align-items:center;font-size:9.5px;letter-spacing:.3px;padding:2px 7px;font-weight:700;color:var(--c-primary,#1B3A5C);background:#EAF0F6;border-radius:20px}
.lg-lib-card .lg-grip{color:#C2CACF;flex:0 0 auto;display:inline-flex}
/* board drag ghost + drop insertion line */
.lg-drag-ghost{position:fixed;z-index:60;pointer-events:none;width:220px;padding:10px 12px;border:1px solid var(--c-primary,#1B3A5C);border-radius:9px;background:#fff;box-shadow:0 12px 28px rgba(20,32,54,.22);font-size:13px;font-weight:700;color:var(--c-primary,#1B3A5C);opacity:.96}
/* §10/S5.1: .lg-drop-indicator(+::before) deleted — 0 references (P5 CSS orphan-scan). */
/* menus + guard dialog */
.lg-board-menus{position:relative}
.lg-menu{position:fixed;z-index:70;background:#fff;border:1px solid var(--c-border);border-radius:10px;box-shadow:0 12px 30px rgba(20,32,54,.18);padding:5px;min-width:186px}
.lg-menu-item{display:flex;align-items:center;gap:9px;font-size:12.5px;font-weight:600;color:var(--c-text);padding:8px 10px;border-radius:6px;cursor:pointer}
.lg-menu-item:hover,.lg-menu-item:focus{background:#EAF0F6;color:var(--c-primary,#1B3A5C);outline:none}
.lg-menu-item.danger{color:#B23A2C}
.lg-menu-sep{height:1px;background:#EEF1F6;margin:4px 6px}
.lg-template-menu{position:fixed;z-index:70;background:#fff;border:1px solid var(--c-border);border-radius:10px;box-shadow:0 12px 30px rgba(20,32,54,.18);padding:5px;min-width:180px}
.lg-board-guard{position:fixed;inset:0;z-index:80;background:rgba(20,28,46,.42);display:flex;align-items:center;justify-content:center;padding:24px}
/* .lg-hidden is defined earlier; this display-setting overlay needs an explicit
   compound override so the SSR-hidden guard stays hidden until the island opens it. */
.lg-board-guard.lg-hidden{display:none}
.lg-board-guard-panel{width:460px;max-width:100%;background:#fff;border-radius:14px;box-shadow:0 24px 64px rgba(20,28,46,.34);overflow:hidden}
.lg-board-guard-head{padding:16px 18px 12px;border-bottom:1px solid #EEF1F6}
.lg-board-guard-head h3{margin:0;font-size:16px;font-weight:800;color:var(--c-text)}
.lg-board-guard-body{padding:16px 18px;font-size:13px;color:#B23A2C;line-height:1.5}
.lg-board-guard-body .lg-guard-blocker{display:flex;gap:8px;align-items:flex-start;background:#FBEEEC;border:1px solid rgba(178,58,44,.28);border-radius:10px;padding:11px 13px;margin-bottom:8px}
.lg-board-guard-foot{padding:12px 18px;border-top:1px solid #EEF1F6;display:flex;justify-content:flex-end;gap:10px;background:#FBFCFD}
.lg-fsettings-body{padding:16px 18px;color:var(--c-text);font-size:13px;max-height:70vh;overflow-y:auto}
.lg-board-inline-err{color:#B23A2C;font-size:12px;font-weight:600;margin:6px 0 0;padding:8px 10px;background:#FBEEEC;border:1px solid rgba(178,58,44,.28);border-radius:8px}
@media (max-width:1100px){.lg-board-shell{flex-direction:column}.lg-board-left,.lg-board-right{flex:1 1 auto;width:auto;border:0;border-bottom:1px solid var(--c-border)}}
`;


// ---------------------------------------------------------------------------
// Editor page (03 §9.4) — five-tab full-page editor
// ---------------------------------------------------------------------------

// Rework M1 (§5-M1, §4.3-10): `is_control` no longer exists on
// leadgen_funnel_variants — "no control concept anywhere." Replacement
// semantics: with no running test a funnel has exactly one active variant
// (validation enforces this); the deterministic pick/tie-break order is
// variant_label ASC, id ASC (labels A/B/C). This recovers, purely from data
// already on hand, "the" variant a funnel edits directly — the same role
// is_control played for the frame/theme override-target split (§4.5), the
// A/B tab's diff baseline, and the default-variant fallback — without any
// DB flag. Every one of ui-quotes.ts's verified is_control read-sites (§5-M1
// inventory) is a caller of this one function.
export function primaryVariantOf(variants: readonly VariantNode[]): VariantNode | null {
  let best: VariantNode | null = null;
  for (const v of variants) {
    if (best === null || v.variant_label < best.variant_label || (v.variant_label === best.variant_label && v.id < best.id)) {
      best = v;
    }
  }
  return best;
}


export function findSelectedVariant(structure: StructureBody, wanted: string): VariantNode | null {
  let firstAny: VariantNode | null = null;
  for (const f of structure.funnels) {
    for (const v of f.variants) {
      if (firstAny === null) firstAny = v;
      if (v.public_id === wanted) return v;
    }
  }
  const firstFunnel = structure.funnels[0] ?? null;
  const primary = firstFunnel ? primaryVariantOf(firstFunnel.variants) : null;
  return primary ?? firstAny;
}


// REMOVED (P3b follow-up round, §8.2/§10): the variant-selector dropdown +
// "Fork this variant" button — the redline's variant chrome above the tabs.
// The A/B tab (renderAbPanel, ./ab.ts) now owns variant switching/creation
// (its per-arm rows + "Add variant…"); the funnel board (renderBuilderPanel)
// never exposes a raw variant concept at all. ui-quotes.ts's paired removal:
// the variantBar block + this export's only call site are both gone.


// ---------------------------------------------------------------------------
// v2.5 04 §4.1 FRAME STUDIO — SSR renderers. The island populates control
// VALUES from the embedded frame/theme state; SSR owns structure + copy.
// ---------------------------------------------------------------------------

// <select> options over a closed enum set, operator labels via the map.
export function enumOptions(
  values: readonly string[],
  labels?: Readonly<Record<string, string>>,
): string {
  return values
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(labels?.[v] ?? v.replace(/_/g, " "))}</option>`)
    .join("");
}


// A 14-role swatch strip bound to one frame/theme key. Swatch backgrounds are
// painted by the island from effective_tokens (no hex in the SSR text).
export function renderRoleStrip(pickFor: string): string {
  const swatches = ROLE_META.map(
    (r) =>
      `<button type="button" class="lg-role-swatch" data-role-pick="${escapeHtml(r.role)}" data-role-pick-for="${escapeHtml(pickFor)}" title="${escapeHtml(r.label)}" aria-label="${escapeHtml(r.label)}"></button>`,
  ).join("");
  return `<div class="lg-role-strip" data-role-strip="${escapeHtml(pickFor)}">${swatches}</div>`;
}


export function frameControl(label: string, control: string, help?: string): string {
  return `<div class="form-group"><label class="form-label">${escapeHtml(label)}</label>${control}${help === undefined ? "" : `<p class="form-help">${escapeHtml(help)}</p>`}</div>`;
}


export function frameCheck(label: string, key: string): string {
  return `<label class="lg-check"><input type="checkbox" data-frame-key="${escapeHtml(key)}" /> ${escapeHtml(label)}</label>`;
}


export function frameSelect(label: string, key: string, values: readonly string[], labels?: Readonly<Record<string, string>>, help?: string): string {
  return frameControl(label, `<select class="form-select" data-frame-key="${escapeHtml(key)}">${enumOptions(values, labels)}</select>`, help);
}


export function frameInput(label: string, key: string, placeholder = "", help?: string): string {
  return frameControl(label, `<input class="form-input" data-frame-key="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" />`, help);
}


// DEV-60 (a) — the reusable media-field affordance (04 §4.4 "media picker").
// A HIDDEN input keeps the exact save key (data-frame-key / data-list-field);
// "Choose…" opens the shared in-page Media-library chooser (#lg-media-picker,
// list + upload via the EXISTING /api/admin/media endpoints); the island
// paints the thumb + Clear from the input value. keyAttr is the carrier
// attribute name so the same shape serves single frame keys AND list rows.
export function mediaFieldMarkup(keyAttr: "data-frame-key" | "data-list-field", key: string, label: string): string {
  return `<span class="lg-media-field" data-media-field>
    <input type="hidden" ${keyAttr}="${escapeHtml(key)}" aria-label="${escapeHtml(label)}" />
    <img class="lg-media-thumb lg-hidden" data-media-thumb alt="" />
    <button type="button" class="btn btn-sm btn-secondary" data-media-choose aria-label="Choose ${escapeHtml(label)} from the Media library">Choose&#8230;</button>
    <button type="button" class="btn btn-sm btn-outline lg-hidden" data-media-clear aria-label="Clear ${escapeHtml(label)}">Clear</button>
  </span>`;
}


export function mediaPickerControl(label: string, key: string, help?: string): string {
  return frameControl(label, mediaFieldMarkup("data-frame-key", key, label), help);
}


// DEV-60 (a) — the curated icon dropdown (closed list, no free text). A
// disabled empty placeholder keeps "unset" representable; unknown STORED
// values are appended by the island as "(stored)" options, never destroyed.
export function iconSelectMarkup(field: string, label: string): string {
  const options = BENEFIT_BAR_ICONS.map(
    (i) => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.value)} ${escapeHtml(i.label)}</option>`,
  ).join("");
  return `<select class="form-select" data-list-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}"><option value="" disabled>Choose an icon</option>${options}</select>`;
}


// §4.5 — the per-group override switch (non-control arms only): "Same as
// funnel (default) / Override for this variant"; writes route the group's
// edits into the sparse frame_overrides_json instead of the funnel frame.
export function renderOverrideSwitch(group: string, isControl: boolean): string {
  if (isControl) return "";
  return `<div class="lg-override-switch" data-override-switch="${escapeHtml(group)}">
    <label class="lg-check"><input type="radio" name="lg-ov-${escapeHtml(group)}" value="inherit" data-override-group="${escapeHtml(group)}" checked /> Same as funnel (default)</label>
    <label class="lg-check"><input type="radio" name="lg-ov-${escapeHtml(group)}" value="override" data-override-group="${escapeHtml(group)}" /> Override for this variant</label>
  </div>`;
}


// §7.1 scope header — first element of every region inspector: "Editing:
// Funnel layout — <Region> · affects every slide of this funnel". Trust strip
// + benefit bar additionally carry the C7 "funnel-wide" chip.
export function scopeHead(regionLabel: string, funnelWide: boolean): string {
  return `<div class="lg-scope-head">Editing: <strong>Funnel layout — ${escapeHtml(regionLabel)}</strong>${funnelWide ? '<span class="lg-scope-chip">funnel-wide</span>' : ""} · affects every slide of this funnel</div>`;
}


// One editable list (footer links / trust logos / benefit items): the island
// fills rows from config and collects rows → whole-array replacement (the
// §13.2 arrays-replace-whole merge rule). DEV-60 (a): a field may be a
// "media" kind (hidden input + Choose… + thumb) or an "icon_select" kind
// (curated closed dropdown) instead of a bare text input.
export function renderFrameList(
  key: string,
  addLabel: string,
  fields: Array<{ field: string; label: string; placeholder?: string; kind?: "text" | "media" | "icon_select" }>,
): string {
  const inputs = fields
    .map((f) => {
      if (f.kind === "media") return mediaFieldMarkup("data-list-field", f.field, f.label);
      if (f.kind === "icon_select") return iconSelectMarkup(f.field, f.label);
      return `<input class="form-input" data-list-field="${escapeHtml(f.field)}" placeholder="${escapeHtml(f.placeholder ?? f.label)}" aria-label="${escapeHtml(f.label)}" />`;
    })
    .join("");
  return `<div data-frame-list="${escapeHtml(key)}"></div>
  <template data-frame-list-tpl="${escapeHtml(key)}"><div class="lg-list-row">${inputs}<button type="button" class="btn btn-sm btn-outline" data-remove-list-row aria-label="Remove">&#10005;</button></div></template>
  <button type="button" class="btn btn-sm btn-secondary" data-add-list-row="${escapeHtml(key)}">${escapeHtml(addLabel)}</button>`;
}


// --- canvas toolbar + canvas (§4.1 center) -----------------------------------

export function renderSiteSelect(id: string, sites: PreviewSiteOption[]): string {
  const options = [`<option value="">CMS fallback branding</option>`]
    .concat(
      sites.map(
        (s) =>
          `<option value="${escapeHtml(s.site_id)}" data-badge="${escapeHtml(s.badge)}">${escapeHtml(s.site_name)} — ${escapeHtml(s.badge)}</option>`,
      ),
    )
    .join("");
  return `<select id="${escapeHtml(id)}" class="form-select" data-site-select aria-label="Preview site">${options}</select>`;
}


// §10/S5.1: renderTemplatePicker (the OLD canvas-embedded 6-arrangement
// template picker — id="lg-template-picker"/"lg-template-confirm"/
// "lg-template-apply"/"lg-template-cancel", data-template-pick cards) was
// REMOVED — confirmed ZERO real callers anywhere in the admin/leadgen
// namespace (its own P5b "deliberate non-move" comment's premise, that moving
// it would break a live Playwright regression, could not be re-verified
// against a function nothing calls). The board's own §8.2 M5 per-funnel-
// column template picker (quotes-tabs/funnel.ts's `data-template-picker`
// pickchip + `applyTemplate`) is the current, live, unrelated mechanism.


// ---------------------------------------------------------------------------
// Rules panel (§15.5) — the raw conditions textarea is REPLACED on the normal
// surface by the B3 visual-builder mount (v2.4 06 §6.10); the legacy textarea
// survives BEHIND an Advanced disclosure per row (same [data-rule-conditions]
// carrier → the save path stays byte-compatible).
// ---------------------------------------------------------------------------

// B3 module (v2.4 06 §6.10 visual condition builder) — real implementation in
// ./ui-rules-builder (frozen interface). The local name aliases the module's
// param type so the two can never drift.
export type RulesBuilderData = Parameters<typeof renderRulesBuilderPanel>[0];


// The #lg-quote-data JSON state blob. `<`-escaped so a hostile author value can
// never break out of the <script type="application/json">. Carries the FULL
// studio boot state — the island fetches nothing on boot except previews.
// DEV-60 (a) — the shared in-page Media-library chooser. ONE dialog per page;
// the island points it at the [data-media-field] that opened it. List +
// upload both ride the EXISTING admin media endpoints (GET /api/admin/media,
// POST /api/admin/media/upload) — no new API surface.
// FIX 8c (§8.4): the SAME "Generate with AI" idiom the Section Studio picker
// ships — the EXISTING POST /api/admin/ai/image endpoint (R2 + media row);
// server-hidden when the route is unavailable (no key ⇒ 501).
export function renderMediaPickerModal(aiImageAvailable: boolean): string {
  return `<div class="lg-media-picker-overlay lg-hidden" id="lg-media-picker" role="dialog" aria-modal="true" aria-label="Choose from the Media library">
  <div class="lg-media-picker-panel">
    <div class="lg-editor-head">
      <h3>Media library</h3>
      <span class="lg-editor-spacer"></span>
      <button type="button" class="btn btn-sm btn-outline" id="lg-media-picker-close">Close</button>
    </div>
    <div class="toolbar">
      <input type="file" id="lg-media-upload-file" accept="image/*" aria-label="Upload a new image" />
      <button type="button" class="btn btn-sm btn-secondary" id="lg-media-upload-btn">Upload &amp; use</button>
      <span class="form-help" id="lg-media-picker-status" role="status"></span>
    </div>
    <div class="toolbar" data-media-ai-generate data-ai-image-available="${aiImageAvailable ? "true" : "false"}"${aiImageAvailable ? "" : " hidden"}>
      <input type="text" id="lg-media-ai-prompt" class="form-input" placeholder="Describe the image to generate&#8230;" aria-label="Describe the image to generate" />
      <button type="button" class="btn btn-sm btn-secondary" id="lg-media-ai-generate">Generate with AI</button>
    </div>
    <div class="lg-media-grid" id="lg-media-picker-grid"></div>
  </div>
</div>`;
}


export function quoteDataBlob(
  structure: StructureBody,
  selected: VariantNode,
  funnelPublicId: string,
  frame: FrameGetBody | null,
  theme: ThemeGetBody | null,
  templates: FrameTemplateItem[],
  sites: PreviewSiteOption[],
  activation: ActivationBody | null,
): string {
  // Rework M1 replacement semantics — see primaryVariantOf's doc comment.
  // The JSON key name stays `selected_variant_is_control` (the client island
  // reads it verbatim) — only its source computation changes.
  const ownFunnel = structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? null;
  const isControl = primaryVariantOf(ownFunnel?.variants ?? [selected])?.public_id === selected.public_id;
  const data = {
    quote_public_id: structure.quote.public_id,
    quote_id: structure.quote.quote_id,
    activity: structure.quote.activity,
    selected_variant: selected.public_id,
    selected_variant_is_control: isControl,
    funnel_public_id: funnelPublicId,
    sections: selected.sections.map((s) => ({ public_id: s.section_public_id, name: s.section_name })),
    frame,
    theme,
    // DEV-60 (d): the BASE design's role→value table (no theme applied) — the
    // island derives the §9.3 harmony steps from these, so a funnel-level
    // palette edit never shifts what "Base / Soft wash / Darker / Lighter"
    // mean (09 §9.3: harmonies derive from the base design).
    base_tokens: resolveTokens(getFunnelDesign(selected.funnel_design_id), null, null).roles,
    templates: templates.map((t) => ({ id: t.id, label: t.label, defaults: t.defaults })),
    sites,
    overrides: selected.frame_overrides_json,
    preflight: activation?.activation_preflight ?? null,
  };
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
