// LeadGen admin UI — Quotes tab (v2.5 redesign-contract 04 + 03 §9.4, Phase-B
// slice B2). The list (Create + filters + timeframe + after-paint analytics
// hydration) and the full-page editor at /admin/leadgen/quotes/:id/edit are
// LIVE. The editor keeps its five sub-tabs — the **Funnel builder** tab is the
// 04 §4.1 FRAME STUDIO (left structure panel · center composed-page canvas in
// a srcdoc iframe fed by POST /variants/:id/preview · right per-region
// inspectors per §4.4 · canvas toolbar: template picker w/ preview-before-
// apply (§4.3, C5), theme editor (09 §9.3), 1280/375 viewport toggle, current
// slide / step-through-all preview modes, site selector (10 §10.5), variant
// selector) — while Rules (the raw conditions textarea replaced by the B3
// visual-builder mount, legacy textarea behind Advanced) · A/B (+ §4.5
// per-arm frame-override listing) · Activation (§17 + 05 §5.2 preflight) ·
// Analytics are PRESERVED. One Save persists frame + theme + variant
// overrides + section order (§4.7) and refreshes the §14.2 publish chip.
// SSR drives the JSON API in-process via ui.ts's apiJson. Inline scripts are
// strict ES5 (layout.ts constraint, asserted by the ES5 parse test — NO
// backticks, NO arrow/const/let, template literals forbidden). Every author
// value is escapeHtml-escaped; JSON blobs are `<`-escaped.

import {
  escapeHtml,
  renderListPager,
  listFilterScript,
  renderKebabOpen,
  KEBAB_CLOSE,
  kebabMenuScript,
} from "../templates/layout";
import { resolveTimeframe, renderTimeframeSelect, type Timeframe } from "../listicles/ui-shared";
import {
  apiJson,
  branding,
  EMPTY_PAGING,
  leadgenPageShell,
  pageParam,
  renderLeadgenTabs,
  statusBadge,
  type ListBody,
  type UiContext,
} from "./ui";
import { listFunnelDesignOptions } from "./quotes-handlers";
import { LEADGEN_ELIGIBILITY_REASON_LABELS, eligibilityReasonLabel } from "./ui-offers";
import type { Paging } from "./router";
import {
  FRAME_BACKGROUND_STYLES,
  FRAME_BACK_POSITIONS,
  FRAME_BACK_STYLES,
  FRAME_BRAND_LOGO_LAYOUTS,
  FRAME_CTA_SLOTS,
  FRAME_DISCLOSURE_LOCATIONS,
  FRAME_DISCLOSURE_MODES,
  FRAME_DISCLOSURE_V2_LOCATIONS,
  FRAME_ELEMENT_ALIGNS,
  FRAME_FOOTER_BLOCK_TYPES,
  FRAME_FOOTER_SHOW_ON,
  FRAME_FREE_TEXT_BLOCK_TYPES,
  FRAME_FREE_TEXT_LIST_STYLES,
  FRAME_FREE_TEXT_SLOTS,
  FRAME_LOGO_ALIGNS,
  FRAME_PAGE_TARGET_MODES,
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
  FRAME_TYPO_SIZES,
} from "../../public/leadgen/designs/frames";
import {
  FUNNEL_TOKEN_ROLES,
  THEME_BUTTON_LAYOUTS,
  THEME_BUTTON_SELECTED_STYLES,
  THEME_BUTTON_STYLES,
  THEME_DISPLAY_SIZE_SCALES,
  THEME_FONT_IDS,
  THEME_RADIUS_SCALES,
  THEME_RADIUS_STEPS,
  THEME_SHADOW_SCALES,
  THEME_SHADOW_STEPS,
  THEME_SIZE_SCALES,
  THEME_SPACING_SCALES,
  resolveTokens,
} from "../../public/leadgen/designs/theme";
import type { Problem } from "../../public/leadgen/designs/theme";
import { getFunnelDesign } from "../../public/leadgen/designs/registry";
// Round-4 P3b: the structure panel renders the FULL page/slot tree. The
// canonical read model is P3a's loadVariantPages (the SAME loader the public
// runtime + quotes-handlers' pageToApi use). No admin GET endpoint projects
// `pages` (variantDetailJson only rides POST create / PUT save / POST fork), so
// the SSR editor sources them directly through this public loader — the import
// pattern quotes-handlers.ts already established — and resolves every slot's
// raw-integer section_id to its public_id + name for the client island. See
// buildPageNodes below.
import { loadVariantPages, type ResolvedFunnelPage } from "../../public/leadgen/resolver";
import { renderRulesBuilderPanel, RULES_BUILDER_SCRIPT } from "./ui-rules-builder";
// Round-4 P4b: the unified routing-rules builder (Image42-shaped modal +
// table) — ADDITIVE to the §21.4 conditions sub-widget above, which it MOUNTS
// rather than replaces (see ui-rules-builder.ts's own P4b section header).
import {
  renderRoutingRulesPanel,
  ROUTING_RULES_SCRIPT,
  ROUTING_RULE_TYPES,
  type RoutingBuilderData,
  type RoutingRuleRowData,
  type RoutingRuleType,
} from "./ui-rules-builder";

// ---------------------------------------------------------------------------
// API shapes (quotes-handlers.ts)
// ---------------------------------------------------------------------------

interface QuoteListItem {
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

interface RuleNode {
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

interface VariantSectionNode {
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

interface VariantNode {
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
interface SectionRef {
  section_id: string; // the section's public_id (what preparePages/resolveRef accepts)
  section_name: string;
  // The section's raw-integer DB id — ONLY set on a fixed slot's ref, where the
  // rendered .lg-section-row keeps its historical NUMERIC data-section-id (the
  // collectSections()/slideStillPresent() readers + the seam harness's
  // `data-section-id="(\d+)"` row regex both require digits).
  num_id?: number;
}
interface AbEntryNode extends SectionRef {
  bp: number;
}
interface RuledCaseNode extends SectionRef {
  conditions: { groups: unknown[] };
}
interface PageSlotNode {
  slot_revision: number;
  kind: "fixed" | "ruled" | "ab";
  fixed: SectionRef | null;
  ab: AbEntryNode[] | null;
  ruled: { cases: RuledCaseNode[]; default_section: SectionRef } | null;
}
interface PageNode {
  name: string | null;
  slots: PageSlotNode[];
}

// Resolve a slot's raw-integer section_id (rules_json / ab_allocations_json)
// to the candidate's public_id + name. The loader returns a slot's candidate
// rows in the SAME order preparePages inserted them (fvs.id ASC == insertion
// order == candidateSectionIds order): for an A/B slot that is exactly the
// allocation order; for a ruled slot it is the de-duplicated first-appearance
// order of [each case's section, then the default]. Replaying that de-dup here
// against the parsed rules gives an integer→candidate index that is faithful
// to what the backend stored — no separate id map is needed from the API.
function slotSectionRefIndex(slot: ResolvedFunnelPage["slots"][number]): Map<number, SectionRef> {
  const index = new Map<number, SectionRef>();
  if (slot.ab_allocations !== null) {
    // A/B: candidate k ↔ allocation k (index-aligned).
    slot.ab_allocations.forEach((alloc, k) => {
      const cand = slot.candidates[k];
      if (cand !== undefined) index.set(alloc.section_id, { section_id: cand.section.public_id, section_name: cand.section.section_name });
    });
    return index;
  }
  if (slot.rules !== null) {
    // Ruled: replay the loader's [unique case sections…, default] ordering.
    const order: number[] = [];
    for (const c of slot.rules.cases) if (!order.includes(c.section_id)) order.push(c.section_id);
    if (!order.includes(slot.rules.default_section_id)) order.push(slot.rules.default_section_id);
    order.forEach((sid, k) => {
      const cand = slot.candidates[k];
      if (cand !== undefined) index.set(sid, { section_id: cand.section.public_id, section_name: cand.section.section_name });
    });
    return index;
  }
  return index;
}

function buildPageNodes(pages: readonly ResolvedFunnelPage[]): PageNode[] {
  return pages.map((page) => ({
    name: page.name,
    slots: page.slots.map((slot): PageSlotNode => {
      const kind: PageSlotNode["kind"] = slot.rules !== null ? "ruled" : slot.ab_allocations !== null ? "ab" : "fixed";
      if (kind === "ab" && slot.ab_allocations !== null) {
        const refs = slotSectionRefIndex(slot);
        return {
          slot_revision: slot.slot_revision,
          kind,
          fixed: null,
          ruled: null,
          ab: slot.ab_allocations.map((alloc): AbEntryNode => {
            const ref = refs.get(alloc.section_id);
            return { section_id: ref?.section_id ?? "", section_name: ref?.section_name ?? "", bp: alloc.bp };
          }),
        };
      }
      if (kind === "ruled" && slot.rules !== null) {
        const refs = slotSectionRefIndex(slot);
        const emptyRef: SectionRef = { section_id: "", section_name: "" };
        return {
          slot_revision: slot.slot_revision,
          kind,
          fixed: null,
          ab: null,
          ruled: {
            cases: slot.rules.cases.map((c): RuledCaseNode => {
              const ref = refs.get(c.section_id) ?? emptyRef;
              return { conditions: c.conditions as { groups: unknown[] }, section_id: ref.section_id, section_name: ref.section_name };
            }),
            default_section: refs.get(slot.rules.default_section_id) ?? emptyRef,
          },
        };
      }
      // fixed: exactly one candidate.
      const cand = slot.candidates[0];
      return {
        slot_revision: slot.slot_revision,
        kind: "fixed",
        ab: null,
        ruled: null,
        fixed: cand !== undefined ? { section_id: cand.section.public_id, section_name: cand.section.section_name, num_id: cand.section.id } : { section_id: "", section_name: "" },
      };
    }),
  }));
}

interface AbTestNode {
  id: number;
  public_id: string;
  funnel_id: number;
  name: string;
  revision: number;
  status: string;
  started_at: number | null;
  stopped_at: number | null;
}

interface FunnelNode {
  id: number;
  public_id: string;
  funnel_id: string;
  funnel_name: string;
  status: string;
  variants: VariantNode[];
  ab_tests: AbTestNode[];
}

interface StructureBody {
  quote: {
    id: number;
    public_id: string;
    quote_id: string;
    quote_name: string;
    activity: string;
    verticals_json: string[];
    status: string;
  };
  funnels: FunnelNode[];
}

interface AvailableSection {
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

interface AuctionListItem {
  id: number;
  public_id: string;
  auction_name: string;
}

interface ActivationSite {
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
interface ActivationPreflightBlock {
  section_id: string;
  section_name: string;
  offer_id: string;
  offer_name: string;
  code: string;
  fields: string[];
  fix_links: { section_mapping?: string; offer_schema?: string };
}

interface ActivationPreflight {
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

interface ActivationBody {
  quote_id: string;
  sites: ActivationSite[];
  activation_preflight?: ActivationPreflight | null;
}

// --- v2.5 04 §4.8 bodies the studio SSR embeds (frame-handlers.ts) ----------

interface FrameGetBody {
  frame_config: Record<string, unknown> | null;
  effective_frame: Record<string, unknown>;
  template_defaults: Record<string, unknown>;
  problems: Problem[];
}

interface ThemeGetBody {
  theme: Record<string, unknown> | null;
  effective_tokens: Record<string, string>;
  problems: Problem[];
}

interface FrameTemplateItem {
  id: string;
  label: string;
  arrangement: string;
  thumbnail_html: string;
  defaults: Record<string, unknown>;
}

interface OfferListItem {
  id: number;
  public_id: string;
  offer_name: string;
}

// The §10.5 site-selector option: ALL CMS sites + the status badge derived
// from this quote's leadgen_site_quotes rows (the activation GET the page
// already queries — no new SQL).
interface PreviewSiteOption {
  site_id: string;
  site_name: string;
  badge: "Active" | "Activation off" | "Not activated yet";
}

function previewSiteOptions(activation: ActivationBody | null): PreviewSiteOption[] {
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

function preflightCodeLabel(code: string): string {
  return PREFLIGHT_BLOCK_CODE_LABELS[code] ?? code.replace(/_/g, " ");
}

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

// The deep-link label derives from the server-provided fix_url (§14.1 copy
// table: [Open Quote Builder] · [Review slide] · site Settings). Kept in
// lockstep with the island's ES5 problemFixLabel.
export function problemFixLabel(fixUrl: string): string {
  if (fixUrl.startsWith("/admin/settings")) return "Open site settings";
  if (fixUrl.includes("/sections/")) return "Review slide";
  if (fixUrl.includes("/quotes/")) return "Open Quote Builder";
  return "Fix";
}

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

function roleLabel(role: string): string {
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

// The frame groups a Variant may override (§4.5) — every §4.4 region group.
const OVERRIDABLE_GROUPS = [
  "header",
  "progress",
  "back",
  "disclosure",
  "footer",
  "trust_strip",
  "benefit_bar",
  "background",
  "section_slot",
] as const;

// ---------------------------------------------------------------------------
// 14 §14.2 — the publish chip: "Blocked (2 errors)" / "Ready (3 warnings)".
// Counts: preflight blocks are error-class + the additive §3.6 problems split
// by severity. The ES5 re-renderer mirrors this EXACT copy.
// ---------------------------------------------------------------------------

function publishChipCounts(preflight: ActivationPreflight | null): { errors: number; warnings: number } {
  if (preflight === null) return { errors: 0, warnings: 0 };
  const problems = preflight.problems ?? [];
  return {
    errors: preflight.blocks.length + problems.filter((p) => p.severity === "error").length,
    warnings: problems.filter((p) => p.severity === "warning").length,
  };
}

function publishChipLabel(counts: { errors: number; warnings: number }): string {
  if (counts.errors > 0) return `Blocked (${counts.errors} ${counts.errors === 1 ? "error" : "errors"})`;
  if (counts.warnings > 0) return `Ready (${counts.warnings} ${counts.warnings === 1 ? "warning" : "warnings"})`;
  return "Ready";
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const LG_QUOTES_STYLES = `
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
.lg-section-row .lg-pos{font-variant-numeric:tabular-nums;color:var(--c-muted);min-width:2em}
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
.lg-ab-note{color:var(--c-muted);font-size:13px;margin:8px 0}
.lg-preview-frame{width:100%;height:640px;border:1px solid var(--c-border);border-radius:8px;background:#fff}
.lg-num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
/* --- v2.5 04 §4.1 frame studio ------------------------------------------- */
.lg-studio{display:grid;grid-template-columns:260px minmax(0,1fr) 320px;gap:12px;align-items:start}
@media (max-width:1100px){.lg-studio{grid-template-columns:1fr}}
.lg-studio-left,.lg-studio-right{display:flex;flex-direction:column;gap:12px}
.lg-canvas-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;border:1px solid var(--c-border);border-radius:8px;margin-bottom:8px}
.lg-canvas-wrap{overflow:auto;border:1px solid var(--c-border);border-radius:8px;padding:8px;background:var(--c-bg,#f6f7f9)}
.lg-canvas-wrap iframe{display:block;margin:0 auto;border:0;background:#fff;height:640px}
.lg-toolbar-sep{width:1px;align-self:stretch;background:var(--c-border)}
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
.lg-progress-style-radios{display:flex;flex-direction:column;gap:6px;margin:4px 0}
.lg-progress-style-opt{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;cursor:pointer}
.lg-progress-style-main{display:flex;align-items:center;gap:8px;min-width:0}
.lg-progress-style-label{white-space:nowrap}
.lg-progress-thumb{width:34px;flex:none}
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
   ONE grid/stack model for the section + slot rows replaces the old
   .lg-section-row / .lg-structure-row flex SPLIT that wrapped and crowded at
   the 260px rail. Every slot row now STACKS an identity line (drag/pos/dot +
   an ellipsizing name cell that never wraps) above a controls rail — so no
   control overlaps the name and nothing overflows the sidebar. Arm rows (plain
   .lg-structure-row, no .lg-section-row/.lg-slot-row) keep the flex layout. */
.lg-structure-hint{margin:0 0 8px}
.lg-page{border:1px solid var(--c-border);border-radius:8px;padding:8px;margin-bottom:10px;background:var(--c-bg,#f6f7f9)}
.lg-page-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;min-width:0}
.lg-page-num{font-variant-numeric:tabular-nums;font-weight:600;font-size:12px;background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:999px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;flex:none}
.lg-page-name{flex:1;min-width:0}
.lg-page-slots{display:flex;flex-direction:column;gap:6px}
.lg-page-add{margin-top:6px}
.lg-slot{background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:6px;overflow:hidden}
.lg-section-row.lg-structure-row,.lg-slot-row.lg-structure-row{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:6px;margin-bottom:0;border:0;border-radius:0;min-width:0}
.lg-slot-line{display:flex;align-items:center;gap:6px;min-width:0}
.lg-name-cell{flex:1;min-width:0;overflow:hidden}
.lg-name-cell button[data-select-slide],.lg-name-cell.lg-slot-summary{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-vertical{flex:none;color:var(--c-muted);font-size:11px;max-width:60px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lg-row-rail{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:4px}
.lg-row-rail .btn{flex:none}
.lg-slot-kind-select{max-width:104px}
.lg-slot-badge{flex:none;font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;color:#fff;background:var(--c-primary,#2563eb);border-radius:4px;padding:1px 6px}
.lg-slot-config{border-top:1px dashed var(--c-border);padding:8px;display:flex;flex-direction:column;gap:6px}
.lg-slot-config .form-help{margin:0}
.lg-ab-cand,.lg-ruled-case{display:flex;flex-wrap:wrap;align-items:center;gap:4px}
.lg-ab-cand .lg-grow,.lg-ruled-case .lg-grow{flex:1;min-width:80px}
.lg-pct{width:54px;flex:none}
.lg-pct-unit{color:var(--c-muted);font-size:12px}
.lg-ruled-if,.lg-ruled-then,.lg-ruled-otherwise{color:var(--c-muted);font-size:12px;flex:none}
.lg-ruled-default{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-top:4px}
.form-select-sm,.form-input-sm{padding:2px 6px;font-size:12px;height:auto;min-height:0}
.lg-map-dot{width:10px;height:10px;border-radius:50%;display:inline-block;background:var(--c-border);flex:none}
/* DEV-59 real tri-state: green complete · amber incomplete · gray none */
.lg-map-dot[data-mapping-status="complete"]{background:#198754}
.lg-map-dot[data-mapping-status="incomplete"]{background:#ffc107}
.lg-map-dot[data-mapping-status="none"]{background:var(--c-border)}
.lg-template-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}
.lg-template-card{border:1px solid var(--c-border);border-radius:8px;padding:8px;cursor:pointer;background:none;text-align:center}
.lg-template-card.selected{border-color:var(--c-primary)}
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
.lg-theme-minipreview{border:1px solid var(--c-border);border-radius:8px;padding:8px;margin:10px 0}
.lg-minipreview-frame{display:block;width:100%;height:200px;border:0;border-radius:6px;background:#fff}
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
.lg-drag-handle{cursor:grab;color:var(--c-muted);font-size:13px;letter-spacing:-3px;flex:none;padding:0 2px;user-select:none}
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
/* --- Round-4 P5b: Templates-tab seven box pickers -------------------------- */
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
`;

// ---------------------------------------------------------------------------
// List page (03 §9.4)
// ---------------------------------------------------------------------------

const QUOTE_LIST_COLUMNS: ReadonlyArray<{ label: string; numeric?: boolean; metric?: string }> = [
  { label: "Name" },
  { label: "Activity" },
  { label: "Verticals" },
  { label: "Variants", numeric: true },
  { label: "A/B status" },
  { label: "Active sites", numeric: true },
  { label: "Visits", numeric: true, metric: "visits" },
  { label: "Completion rate", numeric: true, metric: "completion_rate" },
  { label: "Avg RPS", numeric: true, metric: "avg_rps" },
  { label: "Unfilled rate", numeric: true, metric: "unfilled_rate" },
  { label: "Revenue", numeric: true, metric: "revenue" },
  { label: "Actions" },
];

function abBadge(status: string): string {
  const cls = status === "running" ? "badge badge-published" : "badge badge-draft";
  return `<span class="${cls}" data-ab-status="${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

function renderQuoteListRow(q: QuoteListItem): string {
  const verticals = Array.isArray(q.verticals_json) ? q.verticals_json.join(", ") : "";
  const name = escapeHtml(q.quote_name);
  // Round-4 A-2 (row R4-02/R4-38): Edit stays a direct link; Duplicate/Usage/
  // Archive-or-Reactivate/Delete move into the shared kebab (renderKebabOpen/
  // KEBAB_CLOSE, layout.ts — the offers-tab pattern promoted). Archive/
  // Reactivate are the PATCH {status} leg (patchQuoteHandler already accepts
  // "status"; never blocked) — Delete is the SEPARATE guarded DELETE
  // /quotes/:id (deleteQuoteHandler 409s "This quote has live history —
  // archive it instead" when site_activations/analytics_rows exist, else it
  // also archives). Duplicate → POST /quotes/:id/duplicate; Usage → GET
  // /quotes/:id/usage (new inline panel below, mirrors the Sections pattern).
  const archiveOrReactivate =
    q.status === "archived"
      ? `<button type="button" class="lg-kebab-item" role="menuitem" data-quote-reactivate="${escapeHtml(q.public_id)}" data-entity-name="${name}">Reactivate</button>`
      : `<button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-quote-archive="${escapeHtml(q.public_id)}" data-entity-name="${name}">Archive</button>`;
  return `<tr data-entity-id="${escapeHtml(q.public_id)}" data-entity-name="${name}">
  <td>${name}</td>
  <td>${escapeHtml(q.activity)}</td>
  <td>${escapeHtml(verticals)}</td>
  <td class="lg-num">${q.variant_count}</td>
  <td>${abBadge(q.ab_status)}</td>
  <td class="lg-num">${q.active_sites_count}</td>
  <td class="lg-num" data-metric="visits"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="completion_rate"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="avg_rps"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="unfilled_rate"><span class="skel" aria-hidden="true"></span></td>
  <td class="lg-num" data-metric="revenue"><span class="skel" aria-hidden="true"></span></td>
  <td><div class="table-actions">
    <a href="/admin/leadgen/quotes/${escapeHtml(q.public_id)}/edit" class="btn btn-sm btn-secondary">Edit</a>
    ${renderKebabOpen(name)}<button type="button" class="lg-kebab-item" role="menuitem" data-quote-duplicate="${escapeHtml(q.public_id)}" data-entity-name="${name}">Duplicate</button>
    <button type="button" class="lg-kebab-item" role="menuitem" data-quote-usage="${escapeHtml(q.public_id)}" aria-expanded="false">Usage</button>
    ${archiveOrReactivate}
    <button type="button" class="lg-kebab-item lg-kebab-danger" role="menuitem" data-quote-delete="${escapeHtml(q.public_id)}" data-entity-name="${name}">Delete</button>${KEBAB_CLOSE}
  </div></td>
</tr>
<tr class="lg-usage-row" data-quote-usage-row="${escapeHtml(q.public_id)}" hidden>
  <td colspan="${QUOTE_LIST_COLUMNS.length}"><div class="lg-usage-panel" data-quote-usage-panel role="status" aria-live="polite"></div></td>
</tr>`;
}

function renderQuotesToolbar(
  filters: { search: string; activity: string; status: string },
  activities: string[],
  timeframe: Timeframe,
): string {
  const options = (values: string[], selected: string): string =>
    values
      .map((v) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(v)}</option>`)
      .join("");
  return `<div class="toolbar">
  <a href="/admin/leadgen/quotes/new" class="btn btn-primary" data-create-quote>+ Create a Quote</a>
  <div class="toolbar-search"><input type="search" name="search" class="form-input" placeholder="Search quotes…" value="${escapeHtml(filters.search)}" aria-label="Search quotes" /></div>
  <div class="toolbar-filters">
    <select name="activity" class="form-select" aria-label="Activity"><option value="">All activities</option>${options(activities, filters.activity)}</select>
    <select name="status" class="form-select" aria-label="Status"><option value="">All statuses</option><option value="draft"${filters.status === "draft" ? " selected" : ""}>draft</option><option value="active"${filters.status === "active" ? " selected" : ""}>active</option><option value="archived"${filters.status === "archived" ? " selected" : ""}>archived</option></select>
    ${renderTimeframeSelect(timeframe.key)}
  </div>
</div>`;
}

// The list-page §15.6 analytics hydrator + archive action (strict ES5). Reads
// /quotes/:id/analytics (per-funnel), aggregates across funnels, fills cells.
const QUOTE_LIST_SCRIPT = `
(function () {
  function fmtInt(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return String(Math.round(n)); }
  function fmtMoney(v) { var n = Number(v); if (!isFinite(n)) { n = 0; } return n.toFixed(2); }
  function fmtPct(v) { var n = Number(v); if (!isFinite(n)) { return '\\u2014'; } return (n * 100).toFixed(2) + '%'; }

  function aggregate(funnels) {
    var totals = { visits: 0, completions: 0, unfilled: 0, revenue: 0 };
    var i;
    for (i = 0; i < funnels.length; i++) {
      totals.visits += Number(funnels[i].visits) || 0;
      totals.completions += Number(funnels[i].completions) || 0;
      totals.unfilled += Number(funnels[i].unfilled) || 0;
      totals.revenue += Number(funnels[i].revenue) || 0;
    }
    return totals;
  }

  function cellValue(key, t) {
    if (key === 'visits') { return fmtInt(t.visits); }
    if (key === 'revenue') { return fmtMoney(t.revenue); }
    if (key === 'completion_rate') { return t.visits > 0 ? fmtPct(t.completions / t.visits) : '\\u2014'; }
    if (key === 'avg_rps') { return t.visits > 0 ? fmtMoney(t.revenue / t.visits) : '\\u2014'; }
    if (key === 'unfilled_rate') { return t.visits > 0 ? fmtPct(t.unfilled / t.visits) : '\\u2014'; }
    return '\\u2014';
  }

  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }

  function fillRow(table, row) {
    var id = row.getAttribute('data-entity-id');
    if (!id) { return; }
    var from = table.getAttribute('data-analytics-from') || '';
    var to = table.getAttribute('data-analytics-to') || '';
    var url = '/api/admin/leadgen/quotes/' + encodeURIComponent(id) + '/analytics?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to);
    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      var funnels = (res.ok && res.body && res.body.analytics && res.body.analytics.funnels) ? res.body.analytics.funnels : [];
      var totals = aggregate(funnels);
      var cells = row.querySelectorAll('td[data-metric]');
      var i, key;
      for (i = 0; i < cells.length; i++) {
        key = cells[i].getAttribute('data-metric');
        clearChildren(cells[i]);
        cells[i].appendChild(document.createTextNode(cellValue(key, totals)));
      }
    }).catch(function () {
      var cells = row.querySelectorAll('td[data-metric]');
      var i;
      for (i = 0; i < cells.length; i++) { clearChildren(cells[i]); cells[i].appendChild(document.createTextNode('\\u2014')); }
    });
  }

  var tables = document.querySelectorAll('table[data-lg-analytics]');
  var t, rows, j;
  for (t = 0; t < tables.length; t++) {
    rows = tables[t].querySelectorAll('tbody tr[data-entity-id]');
    for (j = 0; j < rows.length; j++) { fillRow(tables[t], rows[j]); }
  }

  // Round-4 A-2 kebab rollout (row R4-02/R4-38): Archive/Reactivate are the
  // unrestricted PATCH {status} leg; Delete is the SEPARATE guarded DELETE
  // (surfaces the server's plain-language 409 verbatim); Duplicate is a
  // fire-and-reload POST; Usage is a new inline expandable panel (mirrors
  // the Sections list's existing pattern, ui-sections.ts SECTION_LIST_SCRIPT).
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var dupId = el.getAttribute('data-quote-duplicate');
    if (dupId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(dupId) + '/duplicate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({})
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Duplicate failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Duplicate request failed'); });
      return;
    }
    var archiveId = el.getAttribute('data-quote-archive');
    if (archiveId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      if (!window.confirm('Archive this Quote?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(archiveId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ status: 'archived' })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Archive failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Archive request failed'); });
      return;
    }
    var reactivateId = el.getAttribute('data-quote-reactivate');
    if (reactivateId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      if (!window.confirm('Reactivate this Quote?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(reactivateId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ status: 'active' })
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || 'Reactivate failed'); return; }
        window.location.reload();
      }).catch(function () { window.alert('Reactivate request failed'); });
      return;
    }
    var deleteId = el.getAttribute('data-quote-delete');
    if (deleteId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      var deleteName = el.getAttribute('data-entity-name') || 'this quote';
      if (!window.confirm('Delete ' + deleteName + '?')) { return; }
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(deleteId), {
        method: 'DELETE', credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
      }).then(function (res) {
        if (!res.ok) { window.alert((res.body && res.body.error) || ('Delete failed (' + res.status + ')')); return; }
        window.location.reload();
      }).catch(function () { window.alert('Delete request failed'); });
      return;
    }
    var usageId = el.getAttribute('data-quote-usage');
    if (usageId) {
      if (window.lgCloseKebabs) { window.lgCloseKebabs(); }
      var panelRow = document.querySelector('[data-quote-usage-row="' + usageId + '"]');
      if (!panelRow) { return; }
      var wasHidden = panelRow.hidden;
      panelRow.hidden = !wasHidden;
      el.setAttribute('aria-expanded', wasHidden ? 'true' : 'false');
      if (!wasHidden) { return; }
      var panel = panelRow.querySelector('[data-quote-usage-panel]');
      if (!panel || panel.getAttribute('data-loaded') === 'true') { return; }
      panel.appendChild(document.createTextNode('Loading usage\\u2026'));
      fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(usageId) + '/usage', {
        credentials: 'same-origin', headers: { 'Accept': 'application/json' }
      }).then(function (r) { return r.json(); }).then(function (body) {
        var kinds = (body && body.usage && body.usage.kinds) ? body.usage.kinds : [];
        var labels = { site_activations: 'Site activations', analytics_history: 'Analytics history' };
        clearChildren(panel);
        panel.setAttribute('data-loaded', 'true');
        var total = 0;
        var ki;
        for (ki = 0; ki < kinds.length; ki++) { total += Number(kinds[ki].count) || 0; }
        if (total === 0) {
          panel.appendChild(document.createTextNode('Not in use \\u2014 safe to delete or archive.'));
          return;
        }
        for (ki = 0; ki < kinds.length; ki++) {
          var kind = kinds[ki];
          if (!kind.count) { continue; }
          var head = document.createElement('p');
          head.appendChild(document.createTextNode((labels[kind.kind] || kind.kind) + ': ' + kind.count));
          panel.appendChild(head);
          var items = kind.items || [];
          if (items.length > 0) {
            var list = document.createElement('ul');
            var ii;
            for (ii = 0; ii < items.length; ii++) {
              var li = document.createElement('li');
              li.appendChild(document.createTextNode(items[ii].name || items[ii].public_id || String(items[ii].id)));
              list.appendChild(li);
            }
            panel.appendChild(list);
          }
        }
      }).catch(function () {
        clearChildren(panel);
        panel.appendChild(document.createTextNode('Failed to load usage.'));
      });
    }
  });
}());
`;

export async function leadgenQuotesListPage(c: UiContext): Promise<Response> {
  const page = pageParam(c);
  const search = c.req.query("search")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  const timeframe = resolveTimeframe(c.req.query("range"));

  const qs = new URLSearchParams();
  if (page !== "") qs.set("page", page);
  if (search !== "") qs.set("search", search);
  if (activity !== "") qs.set("activity", activity);
  if (status !== "") qs.set("status", status);
  const query = qs.toString();

  const listed = await apiJson<ListBody<QuoteListItem>>(
    c.env,
    `/api/admin/leadgen/quotes${query === "" ? "" : `?${query}`}`,
  );
  const activitiesRes = await apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/activities");

  const items = listed.ok ? listed.body.items : [];
  const paging: Paging = listed.ok ? listed.body.paging : EMPTY_PAGING;
  const rows =
    items.length === 0
      ? `<tr><td colspan="${QUOTE_LIST_COLUMNS.length}"><div class="empty-state"><p>No quotes yet.</p><p class="form-help">Create a Quote to build a funnel.</p></div></td></tr>`
      : items.map(renderQuoteListRow).join("");

  const headerCells = QUOTE_LIST_COLUMNS.map((col) => {
    const cls = col.numeric === true ? ' class="lg-num"' : "";
    return `<th scope="col"${cls}>${escapeHtml(col.label)}</th>`;
  }).join("");

  const loadErrorHtml = listed.ok
    ? ""
    : `<p class="alert alert-error" role="alert">${escapeHtml(listed.error)}</p>`;

  const content = `${renderLeadgenTabs("quotes")}
${loadErrorHtml}
${renderQuotesToolbar({ search, activity, status }, activitiesRes.ok ? activitiesRes.body.items : [], timeframe)}
<div class="card">
  <div class="table-wrapper">
    <table class="table table--sticky-edges leadgen-quotes-list" aria-label="Quotes list" data-lg-analytics data-analytics-from="${escapeHtml(timeframe.from)}" data-analytics-to="${escapeHtml(timeframe.to)}">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
${renderListPager({ page: paging.page, per_page: paging.page_size, total: paging.total }, { page })}`;

  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/quotes",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_QUOTES_STYLES,
      scripts: kebabMenuScript + QUOTE_LIST_SCRIPT + listFilterScript,
    }),
  );
}

// ---------------------------------------------------------------------------
// New-quote page (§10.1-style create → then editor)
// ---------------------------------------------------------------------------

// Round-4 P5b (10A): Activity becomes a select fed by the existing
// GET /activities; an inline "+ Add a new activity…" sentinel reveals a
// free-text escape hatch (the ONLY way to author a brand-new activity, since
// the select is otherwise a closed list of what already exists). Verticals
// becomes a multi-select fed by GET /verticals, with its OWN "+ Add" affordance
// that appends (and selects) a new <option> — never destroying the existing
// selection. The WIRE payload is UNCHANGED: `verticals` still sends a plain
// array of the selected/added strings (parseStringArray, quotes-handlers.ts,
// accepts exactly that shape) — only the AUTHORING affordance changes.
const QUOTE_NEW_SCRIPT = `
(function () {
  var form = document.getElementById('lg-quote-new-form');
  if (!form) { return; }
  var errBox = document.getElementById('lg-quote-new-error');
  var activitySel = document.getElementById('lg-q-activity');
  var activityNew = document.getElementById('lg-q-activity-new');
  if (activitySel && activityNew) {
    activitySel.addEventListener('change', function () {
      var isNew = activitySel.value === '__new__';
      // the SSR default is class="form-input lg-hidden" (display:none) — the
      // native .hidden property does not override that CSS class, so the
      // class itself must flip here (the file's established idiom, e.g.
      // togglePanel/showRegionPanel above).
      activityNew.className = isNew ? 'form-input' : 'form-input lg-hidden';
      if (isNew) { activityNew.focus(); }
    });
  }
  var verticalsSel = document.getElementById('lg-q-verticals');
  var vNewInput = document.getElementById('lg-q-verticals-new');
  var vAddBtn = document.getElementById('lg-q-verticals-add');
  function addVerticalOption(value) {
    var v = (value || '').replace(/^\\s+|\\s+$/g, '');
    if (!v || !verticalsSel) { return; }
    var opts = verticalsSel.options;
    var i;
    for (i = 0; i < opts.length; i++) { if (opts[i].value === v) { opts[i].selected = true; return; } }
    var opt = document.createElement('option');
    opt.value = v;
    opt.appendChild(document.createTextNode(v));
    opt.selected = true;
    verticalsSel.appendChild(opt);
  }
  if (vAddBtn && vNewInput) {
    vAddBtn.addEventListener('click', function () {
      addVerticalOption(vNewInput.value);
      vNewInput.value = '';
      vNewInput.focus();
    });
  }
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = (document.getElementById('lg-q-name').value || '').trim();
    var activity = activitySel ? activitySel.value : '';
    if (activity === '__new__') { activity = ((activityNew && activityNew.value) || '').trim(); }
    var verticals = [];
    if (verticalsSel) {
      var vOpts = verticalsSel.options;
      var j;
      for (j = 0; j < vOpts.length; j++) { if (vOpts[j].selected) { verticals.push(vOpts[j].value); } }
    }
    var payload = { quote_name: name, activity: activity, verticals: verticals };
    var btn = document.getElementById('lg-quote-new-save');
    if (btn) { btn.disabled = true; }
    fetch('/api/admin/leadgen/quotes', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (res.ok && res.body && res.body.public_id) {
        window.location.href = '/admin/leadgen/quotes/' + encodeURIComponent(res.body.public_id) + '/edit';
        return;
      }
      if (btn) { btn.disabled = false; }
      if (errBox) {
        var msg = (res.body && res.body.error) ? res.body.error : 'Create failed';
        errBox.textContent = msg;
        errBox.hidden = false;
      }
    }).catch(function () {
      if (btn) { btn.disabled = false; }
      if (errBox) { errBox.textContent = 'Network error'; errBox.hidden = false; }
    });
  });
}());
`;

export async function leadgenQuotesNewPage(c: UiContext): Promise<Response> {
  const [activitiesRes, verticalsRes] = await Promise.all([
    apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/activities"),
    apiJson<{ items: string[] }>(c.env, "/api/admin/leadgen/verticals"),
  ]);
  const activities = activitiesRes.ok ? activitiesRes.body.items : [];
  const verticals = verticalsRes.ok ? verticalsRes.body.items : [];
  const activityOptions = activities.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  const verticalOptions = verticals.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  const content = `${renderLeadgenTabs("quotes")}
<div class="lg-editor-head">
  <a href="/admin/leadgen/quotes" class="btn btn-outline">&#8592; Quotes</a>
  <h2 class="lg-editor-title">New Quote</h2>
</div>
<p id="lg-quote-new-error" class="alert alert-error" hidden role="alert"></p>
<div class="card">
  <form id="lg-quote-new-form" novalidate>
    <div class="lg-scalars">
      <div class="form-group">
        <label class="form-label" for="lg-q-name">Quote name *</label>
        <input id="lg-q-name" name="quote_name" class="form-input" required aria-required="true" />
      </div>
      <div class="form-group">
        <label class="form-label" for="lg-q-activity">Activity *</label>
        <select id="lg-q-activity" name="activity" class="form-select" required aria-required="true">
          <option value="">Choose an activity&#8230;</option>
          ${activityOptions}
          <option value="__new__">+ Add a new activity&#8230;</option>
        </select>
        <input id="lg-q-activity-new" class="form-input lg-hidden" placeholder="New activity name" aria-label="New activity name" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-q-verticals">Verticals * (select one or more)</label>
      <select id="lg-q-verticals" name="verticals" class="form-select" multiple size="5" required aria-required="true">${verticalOptions}</select>
      <div class="lg-list-row">
        <input id="lg-q-verticals-new" class="form-input" placeholder="Add a new vertical&#8230;" aria-label="New vertical name" />
        <button type="button" id="lg-q-verticals-add" class="btn btn-sm btn-secondary">+ Add</button>
      </div>
      <span class="form-help">Hold Ctrl/Cmd to select more than one, or type a new one and "+ Add".</span>
    </div>
    <button type="submit" id="lg-quote-new-save" class="btn btn-primary">Create Quote</button>
    <span class="form-help">A funnel + control variant are created automatically (§15.1: every Quote has ≥1 variant).</span>
  </form>
</div>`;
  return c.html(
    leadgenPageShell({
      activePath: "/admin/leadgen/quotes",
      userEmail: branding(c).userEmail,
      content,
      styles: LG_QUOTES_STYLES,
      scripts: QUOTE_NEW_SCRIPT,
    }),
  );
}

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
function primaryVariantOf(variants: readonly VariantNode[]): VariantNode | null {
  let best: VariantNode | null = null;
  for (const v of variants) {
    if (best === null || v.variant_label < best.variant_label || (v.variant_label === best.variant_label && v.id < best.id)) {
      best = v;
    }
  }
  return best;
}

function findSelectedVariant(structure: StructureBody, wanted: string): VariantNode | null {
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

function renderVariantSelector(structure: StructureBody, selected: VariantNode): string {
  const opts: string[] = [];
  for (const f of structure.funnels) {
    for (const v of f.variants) {
      const label = `${f.funnel_name} · ${v.variant_label}`;
      opts.push(
        `<option value="${escapeHtml(v.public_id)}"${v.public_id === selected.public_id ? " selected" : ""}>${escapeHtml(label)}</option>`,
      );
    }
  }
  return `<div class="form-group">
  <label class="form-label" for="lg-variant-select">Variant</label>
  <select id="lg-variant-select" class="form-select">${opts.join("")}</select>
</div>`;
}

// ---------------------------------------------------------------------------
// v2.5 04 §4.1 FRAME STUDIO — SSR renderers. The island populates control
// VALUES from the embedded frame/theme state; SSR owns structure + copy.
// ---------------------------------------------------------------------------

// <select> options over a closed enum set, operator labels via the map.
function enumOptions(
  values: readonly string[],
  labels?: Readonly<Record<string, string>>,
): string {
  return values
    .map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(labels?.[v] ?? v.replace(/_/g, " "))}</option>`)
    .join("");
}

// A 14-role swatch strip bound to one frame/theme key. Swatch backgrounds are
// painted by the island from effective_tokens (no hex in the SSR text).
function renderRoleStrip(pickFor: string): string {
  const swatches = ROLE_META.map(
    (r) =>
      `<button type="button" class="lg-role-swatch" data-role-pick="${escapeHtml(r.role)}" data-role-pick-for="${escapeHtml(pickFor)}" title="${escapeHtml(r.label)}" aria-label="${escapeHtml(r.label)}"></button>`,
  ).join("");
  return `<div class="lg-role-strip" data-role-strip="${escapeHtml(pickFor)}">${swatches}</div>`;
}

function frameControl(label: string, control: string, help?: string): string {
  return `<div class="form-group"><label class="form-label">${escapeHtml(label)}</label>${control}${help === undefined ? "" : `<p class="form-help">${escapeHtml(help)}</p>`}</div>`;
}

function frameCheck(label: string, key: string): string {
  return `<label class="lg-check"><input type="checkbox" data-frame-key="${escapeHtml(key)}" /> ${escapeHtml(label)}</label>`;
}

function frameSelect(label: string, key: string, values: readonly string[], labels?: Readonly<Record<string, string>>, help?: string): string {
  return frameControl(label, `<select class="form-select" data-frame-key="${escapeHtml(key)}">${enumOptions(values, labels)}</select>`, help);
}

function frameInput(label: string, key: string, placeholder = "", help?: string): string {
  return frameControl(label, `<input class="form-input" data-frame-key="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" />`, help);
}

// DEV-60 (a) — the reusable media-field affordance (04 §4.4 "media picker").
// A HIDDEN input keeps the exact save key (data-frame-key / data-list-field);
// "Choose…" opens the shared in-page Media-library chooser (#lg-media-picker,
// list + upload via the EXISTING /api/admin/media endpoints); the island
// paints the thumb + Clear from the input value. keyAttr is the carrier
// attribute name so the same shape serves single frame keys AND list rows.
function mediaFieldMarkup(keyAttr: "data-frame-key" | "data-list-field", key: string, label: string): string {
  return `<span class="lg-media-field" data-media-field>
    <input type="hidden" ${keyAttr}="${escapeHtml(key)}" aria-label="${escapeHtml(label)}" />
    <img class="lg-media-thumb lg-hidden" data-media-thumb alt="" />
    <button type="button" class="btn btn-sm btn-secondary" data-media-choose aria-label="Choose ${escapeHtml(label)} from the Media library">Choose&#8230;</button>
    <button type="button" class="btn btn-sm btn-outline lg-hidden" data-media-clear aria-label="Clear ${escapeHtml(label)}">Clear</button>
  </span>`;
}

function mediaPickerControl(label: string, key: string, help?: string): string {
  return frameControl(label, mediaFieldMarkup("data-frame-key", key, label), help);
}

// DEV-60 (a) — the curated icon dropdown (closed list, no free text). A
// disabled empty placeholder keeps "unset" representable; unknown STORED
// values are appended by the island as "(stored)" options, never destroyed.
function iconSelectMarkup(field: string, label: string): string {
  const options = BENEFIT_BAR_ICONS.map(
    (i) => `<option value="${escapeHtml(i.value)}">${escapeHtml(i.value)} ${escapeHtml(i.label)}</option>`,
  ).join("");
  return `<select class="form-select" data-list-field="${escapeHtml(field)}" aria-label="${escapeHtml(label)}"><option value="" disabled>Choose an icon</option>${options}</select>`;
}

// §4.5 — the per-group override switch (non-control arms only): "Same as
// funnel (default) / Override for this variant"; writes route the group's
// edits into the sparse frame_overrides_json instead of the funnel frame.
function renderOverrideSwitch(group: string, isControl: boolean): string {
  if (isControl) return "";
  return `<div class="lg-override-switch" data-override-switch="${escapeHtml(group)}">
    <label class="lg-check"><input type="radio" name="lg-ov-${escapeHtml(group)}" value="inherit" data-override-group="${escapeHtml(group)}" checked /> Same as funnel (default)</label>
    <label class="lg-check"><input type="radio" name="lg-ov-${escapeHtml(group)}" value="override" data-override-group="${escapeHtml(group)}" /> Override for this variant</label>
  </div>`;
}

// §7.1 scope header — first element of every region inspector: "Editing:
// Funnel layout — <Region> · affects every slide of this funnel". Trust strip
// + benefit bar additionally carry the C7 "funnel-wide" chip.
function scopeHead(regionLabel: string, funnelWide: boolean): string {
  return `<div class="lg-scope-head">Editing: <strong>Funnel layout — ${escapeHtml(regionLabel)}</strong>${funnelWide ? '<span class="lg-scope-chip">funnel-wide</span>' : ""} · affects every slide of this funnel</div>`;
}

// One editable list (footer links / trust logos / benefit items): the island
// fills rows from config and collects rows → whole-array replacement (the
// §13.2 arrays-replace-whole merge rule). DEV-60 (a): a field may be a
// "media" kind (hidden input + Choose… + thumb) or an "icon_select" kind
// (curated closed dropdown) instead of a bare text input.
function renderFrameList(
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

// --- the ten §4.4 region inspectors ------------------------------------------

function renderHeaderInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="header">
  ${scopeHead("Header", false)}
  ${renderOverrideSwitch("header", isControl)}
  ${frameCheck("Show the header", "header.enabled")}
  ${frameSelect("Logo source", "header.logo_source", ["site", "cms_fallback"], { site: "Site logo (auto)", cms_fallback: "CMS fallback" })}
  ${frameSelect("Logo size", "header.logo_size", FRAME_SIZES, { s: "Small", m: "Medium", l: "Large" })}
  ${frameSelect("Alignment", "header.logo_align", FRAME_LOGO_ALIGNS, { left: "Left", center: "Center" })}
  ${frameInput("Tagline", "header.tagline", "e.g. Compare quotes in minutes")}
  ${frameCheck("Show the secure badge", "header.secure_badge.enabled")}
  ${frameInput("Secure badge text", "header.secure_badge.text", "Safe, secure & confidential")}
  ${frameCheck("Show a call button", "header.cta.enabled")}
  ${frameInput("Call button label", "header.cta.label", "Call now")}
  ${frameInput("Phone number", "header.cta.tel", "+1 555 123 4567")}
  ${frameInput("Link (instead of a phone number)", "header.cta.href", "https://…")}
  ${frameCheck("Show the disclosure link in the header", "header.disclosure_link")}
  ${frameCheck("Keep the header visible while scrolling (sticky)", "header.sticky")}
  <details class="lg-advanced"><summary>Advanced</summary>
    <label class="lg-check"><input type="checkbox" data-manual-logo /> Use a manual logo instead of site branding</label>
    <p class="form-help">Manual logo overrides site branding.</p>
    ${mediaPickerControl("Manual logo image (from the Media library)", "header.logo_media_id")}
  </details>
</div>`;
}

// Round-4 P5b (Image15 ruling): every FRAME_PROGRESS_STYLES value gets its own
// operator label — the previous nested-ternary chain silently mislabeled the
// P5a-added `icon_on_track` style as "Percent" (it fell through the ternary's
// final else). A lookup map makes every style's label explicit and keeps a
// future style addition a one-line diff instead of another ternary link.
const PROGRESS_STYLE_LABELS: Readonly<Record<string, string>> = {
  hidden: "Hidden",
  bar: "Bar",
  dots: "Dots",
  numbered: "Numbered",
  percent: "Percent",
  icon_on_track: "Icon on track",
};

function renderProgressInspector(isControl: boolean): string {
  // Image15 ruling: aligned rows, the selection mark RIGHT of the label (kills
  // the previous orphaned-circle-above-bar layout — `.lg-tpl-band` is
  // `display:block`, so the radio + thumbnail + text used to wrap onto their
  // own lines inside the inline <label>). The main content (thumbnail + text)
  // renders FIRST, the radio LAST, inside a flex row (`.lg-progress-style-opt`,
  // `justify-content:space-between`) so the mark's x is always to the right of
  // the label's x and every option is one aligned row in a vertical stack
  // (`.lg-progress-style-radios{flex-direction:column}`).
  const styleRadios = FRAME_PROGRESS_STYLES.map((s) => {
    const label = PROGRESS_STYLE_LABELS[s] ?? s;
    return `<label class="lg-check lg-progress-style-opt">
      <span class="lg-progress-style-main">
        <span class="lg-tpl-band lg-progress-thumb lg-progress-thumb--${escapeHtml(s)}" aria-hidden="true"></span>
        <span class="lg-progress-style-label">${escapeHtml(label)}</span>
      </span>
      <input type="radio" name="lg-progress-style" value="${escapeHtml(s)}" data-frame-key="progress.style" data-frame-radio="1" />
    </label>`;
  }).join("");
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="progress">
  ${scopeHead("Progress", false)}
  ${renderOverrideSwitch("progress", isControl)}
  ${frameControl("Style", `<div class="lg-progress-style-radios">${styleRadios}</div>`)}
  ${frameSelect("Position", "progress.position", FRAME_PROGRESS_POSITIONS, { top: "Top of page", under_header: "Under the header", above_unit: "Above the question unit", in_card: "Inside the card" })}
  ${frameSelect("Thickness", "progress.thickness", FRAME_SIZES, { s: "Thin", m: "Medium", l: "Thick" })}
  ${frameSelect("Width", "progress.width", FRAME_PROGRESS_WIDTHS, { content: "Content width", full: "Full width" })}
  ${frameControl("Color", renderRoleStrip("progress.color_role"))}
  ${frameCheck("Show a label", "progress.show_label")}
  ${frameSelect("Alignment", "progress.align", ["center", ...FRAME_PROGRESS_ALIGNS.filter((a) => a !== "center")], { left: "Left", center: "Center", right: "Right" }, "Round-4 P5a: aligns the progress unit within its width band (defaults to Center).")}
  <p class="lg-region-note">Progress counts the slides of this funnel variant automatically.</p>
</div>`;
}

function renderBackInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="back">
  ${scopeHead("Back", false)}
  ${renderOverrideSwitch("back", isControl)}
  ${frameSelect("Style", "back.style", FRAME_BACK_STYLES, { hidden: "Hidden", text: "Text link", icon_text: "Icon + text", button: "Button" })}
  ${frameSelect("Position", "back.position", FRAME_BACK_POSITIONS, { under_header_left: "Under the header (left)", in_card: "Inside the card", below_card: "Below the card", footer: "In the footer" })}
  ${frameInput("Label", "back.label", "Back")}
  <p class="lg-region-note">Hidden automatically on the first slide.</p>
</div>`;
}

function renderDisclosureInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="disclosure">
  ${scopeHead("Disclosure", false)}
  ${renderOverrideSwitch("disclosure", isControl)}
  ${frameCheck("Show the advertising disclosure", "disclosure.enabled")}
  ${frameSelect("Location", "disclosure.location", FRAME_DISCLOSURE_LOCATIONS, { top_bar: "Top bar", header: "Header", footer: "Footer", modal: "Pop-up panel" })}
  ${frameInput("Link label", "disclosure.link_label", "Advertising Disclosure")}
  ${frameControl("Panel text", `<textarea class="form-input" rows="4" data-frame-key="disclosure.text" placeholder="The disclosure copy shown to visitors"></textarea>`)}
</div>`;
}

function renderFooterInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="footer">
  ${scopeHead("Footer", false)}
  ${renderOverrideSwitch("footer", isControl)}
  ${frameCheck("Show the footer", "footer.enabled")}
  ${frameSelect("Show on", "footer.show_on", FRAME_FOOTER_SHOW_ON, { all: "Every slide", first: "First slide", final: "Final slide", never: "Never" })}
  ${frameSelect("Links source", "footer.links_source", ["site", "manual"], { site: "From site settings", manual: "Manual list" })}
  ${frameControl("Manual links", renderFrameList("footer.links", "+ Add link", [
    { field: "label", label: "Label" },
    { field: "href", label: "Link", placeholder: "https://… or /page" },
  ]))}
  ${frameInput("Trust text", "footer.trust_text", "e.g. Licensed in all 50 states")}
  ${frameInput("Description", "footer.description", "Short legal description")}
  ${frameCheck("Show the logo in the footer", "footer.show_logo")}
  ${frameCheck("Hide on mobile", "footer.hide_on_mobile")}
</div>`;
}

function renderTrustStripInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="trust_strip">
  ${scopeHead("Trust strip", true)}
  ${renderOverrideSwitch("trust_strip", isControl)}
  ${frameCheck("Show the trust strip", "trust_strip.enabled")}
  ${frameSelect("Source", "trust_strip.source", ["manual", "site_logo_set"], { manual: "Manual logos", site_logo_set: "Site logo set" })}
  ${frameControl("Logos", renderFrameList("trust_strip.logos", "+ Add logo", [
    { field: "media_id", label: "Image (from the Media library)", kind: "media" },
    { field: "alt", label: "Alt text (required)", placeholder: "Alt text (required)" },
  ]))}
  ${frameSelect("Placement", "trust_strip.placement", FRAME_TRUST_PLACEMENTS, { below_unit: "Below the question unit", footer: "In the footer", between_progress_and_unit: "Between progress and the question unit" })}
  ${frameSelect("Mobile behavior", "trust_strip.mobile", FRAME_TRUST_MOBILE_MODES, { wrap: "Wrap", scroll: "Scroll", hide: "Hide" })}
</div>`;
}

function renderBenefitBarInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="benefit_bar">
  ${scopeHead("Benefit bar", true)}
  ${renderOverrideSwitch("benefit_bar", isControl)}
  ${frameCheck("Show the benefit bar", "benefit_bar.enabled")}
  ${frameControl("Items", renderFrameList("benefit_bar.items", "+ Add item", [
    { field: "icon", label: "Icon", kind: "icon_select" },
    { field: "text", label: "Text" },
  ]))}
  ${frameSelect("Placement", "benefit_bar.placement", ["bottom", "below_unit"], { bottom: "Bottom of page", below_unit: "Below the question unit" })}
</div>`;
}

function renderBackgroundInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="background">
  ${scopeHead("Background", false)}
  ${renderOverrideSwitch("background", isControl)}
  ${frameControl("Color", renderRoleStrip("background.role"))}
  ${mediaPickerControl("Background image (optional, from the Media library)", "background.image_media_id")}
  ${frameSelect("Style", "background.style", FRAME_BACKGROUND_STYLES, { flat: "Flat", brand: "Brand", brand_gradient: "Brand gradient" })}
</div>`;
}

function renderSectionSlotInspector(isControl: boolean): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-region-panel="section_slot">
  ${scopeHead("Section slot", false)}
  ${renderOverrideSwitch("section_slot", isControl)}
  ${frameSelect("Max width", "section_slot.max_width", FRAME_SIZES, { s: "Narrow", m: "Medium", l: "Wide" })}
  ${frameSelect("Card", "section_slot.card", FRAME_SLOT_CARDS, { card: "Card", bare: "Bare" })}
  ${frameSelect("Padding", "section_slot.padding", FRAME_SIZES, { s: "Compact", m: "Medium", l: "Roomy" })}
  ${frameSelect("Vertical offset", "section_slot.offset_y", FRAME_SLOT_OFFSETS, { none: "None", s: "Small", m: "Medium" })}
  ${frameCheck("Allow a Section-local card", "section_slot.allow_section_card")}
  ${frameSelect("Transition", "section_slot.transition", FRAME_SLOT_TRANSITIONS, { fade: "Fade", none: "None" })}
  ${frameSelect("Continue placement", "section_slot.continue_placement", ["inside_unit", "below_unit"], { inside_unit: "Inside the question unit", below_unit: "Below the question unit" })}
  ${frameControl("Continue style", renderRoleStrip("section_slot.continue_style_role"))}
  <p class="lg-region-note">Continue is only shown when the current Section uses button mode.</p>
</div>`;
}

// C2 — Compatibility, its own Advanced-collapsed group (§4.4 last row), with
// the EXACT consequence sentence inline.
function renderCompatibilityInspector(): string {
  return `<details class="lg-advanced" data-region-panel-compat>
  <summary>Advanced</summary>
  <div class="lg-panel-card" style="border:0;padding:8px 0 0">
    <h3>Compatibility</h3>
    ${frameCheck("Allow slides to keep their own page chrome (legacy)", "compat.allow_section_chrome")}
    <p class="form-help">ON: publishing warns instead of blocking when slides contain their own header/progress/footer — the live page may show them twice.</p>
  </div>
</details>`;
}

// Round-4 P4b: `routingData`/`variant` are optional so every OTHER existing
// caller of this function stays byte-identical (none currently pass them);
// `renderBuilderPanel` below is the ONE caller that does, embedding the
// unified routing-rules table+modal at the BOTTOM of this right-hand column
// per the operator's restructure spec ("rules panel surfaced INSIDE the
// funnel-builder tab, right side") — the standalone Rules top tab is removed
// (see quoteEditorHtml/leadgenQuoteEditorPage).
function renderInspectorColumn(isControl: boolean, variant?: VariantNode, routingData?: RoutingBuilderData): string {
  return `<div class="lg-studio-right" id="lg-inspector-column">
  <p class="form-help" id="lg-inspector-hint">Click a region of the page on the canvas to edit it.</p>
  ${renderHeaderInspector(isControl)}
  ${renderProgressInspector(isControl)}
  ${renderBackInspector(isControl)}
  ${renderDisclosureInspector(isControl)}
  ${renderFooterInspector(isControl)}
  ${renderTrustStripInspector(isControl)}
  ${renderBenefitBarInspector(isControl)}
  ${renderBackgroundInspector(isControl)}
  ${renderSectionSlotInspector(isControl)}
  ${renderCompatibilityInspector()}
  ${variant && routingData ? renderRulesPanel(variant, routingData) : ""}
</div>`;
}

// --- left structure panel (§4.1) ---------------------------------------------

// DEV-59: the structure-panel mapping dot decodes to a tri-state in operator
// words — REAL data from the structure body (quotes-handlers
// variantSectionMappingStatus, the mappingSummaryOf/sectionValidationStatus
// parity aggregate), never a placeholder. The list API's 4-state
// `completeness` (add-picker leg) folds invalid→incomplete: both mean "not
// ready to publish" and the dot vocabulary is the DEV-59 tri-state.
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

// Round-4 P3b entry-known slot-rule vocabulary (mirrors resolver.ts
// ENTRY_KNOWN_SLOT_FIELDS — a ruled slot may branch ONLY on these). The
// operator sees plain labels; the value goes out verbatim as the condition
// group's `value` (the §21.4 composed-group evaluator conditionsMatch reads
// {field, op, value}). `eq`/`neq` are the two ops the builder exposes.
const RULED_FIELD_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["state", "State"],
  ["device", "Device"],
  ["utm_source", "UTM source"],
  ["utm_medium", "UTM medium"],
  ["utm_content", "UTM content"],
  ["hour", "Hour (UTC 0–23)"],
  ["weekday", "Weekday (UTC 0–6)"],
];
const RULED_OP_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["eq", "is"],
  ["neq", "is not"],
];

function ruledFieldOptions(selected: string): string {
  return RULED_FIELD_OPTIONS.map(
    ([v, label]) => `<option value="${v}"${v === selected ? " selected" : ""}>${escapeHtml(label)}</option>`,
  ).join("");
}
function ruledOpOptions(selected: string): string {
  return RULED_OP_OPTIONS.map(
    ([v, label]) => `<option value="${v}"${v === selected ? " selected" : ""}>${escapeHtml(label)}</option>`,
  ).join("");
}

// Section <option>s addressed by PUBLIC id — for the A/B candidate + ruled
// case/default selects (preparePages.resolveRef accepts a public_id string).
function sectionRefOptions(available: AvailableSection[], selectedPublicId: string): string {
  const opts = available
    .map(
      (s) =>
        `<option value="${escapeHtml(s.public_id)}"${s.public_id === selectedPublicId ? " selected" : ""}>${escapeHtml(s.section_name)} (${escapeHtml(s.vertical)})</option>`,
    )
    .join("");
  return `<option value="">— choose a section —</option>${opts}`;
}

// The fixed-slot ADD picker <option>s (numeric value == the existing add
// contract; data-* mirror the section name/vertical/mapping so a client-side
// add stamps a truthful row WITHOUT a reload). The public id rides as
// `data-section-public` — deliberately NOT `data-section-public-id`, so the
// DEV-59 mapping-dot probe's `data-section-public-id="…"` row search never
// matches an <option> before the rendered .lg-section-row. fixedSlotFromOption
// copies it onto the row's data-section-public-id (needed so a fixed→A/B switch
// can seed the A/B candidate, whose select is keyed by public id).
function sectionAddOptions(available: AvailableSection[]): string {
  return available
    .map(
      (s) =>
        `<option value="${s.id}" data-section-public="${escapeHtml(s.public_id)}" data-section-name="${escapeHtml(s.section_name)}" data-vertical="${escapeHtml(s.vertical)}" data-mapping-status="${mappingDotStatus(s.completeness)}">${escapeHtml(s.section_name)} (${escapeHtml(s.vertical)})</option>`,
    )
    .join("");
}

function slotKindSelect(kind: string): string {
  return `<select class="form-select form-select-sm lg-slot-kind-select" data-slot-kind-select aria-label="How this slot resolves">
      <option value="fixed"${kind === "fixed" ? " selected" : ""}>One section</option>
      <option value="ruled"${kind === "ruled" ? " selected" : ""}>Rule&#8230;</option>
      <option value="ab"${kind === "ab" ? " selected" : ""}>A/B&#8230;</option>
    </select>`;
}

// The shared right-rail controls every slot body carries: kind switch, move
// across pages, reorder within the page, remove.
function slotRail(kind: string): string {
  return `<span class="lg-row-rail">
    ${slotKindSelect(kind)}
    <button type="button" class="btn btn-sm btn-outline" data-slot-move-prev aria-label="Move to previous page" title="Move to previous page">&#9668;</button>
    <button type="button" class="btn btn-sm btn-outline" data-slot-move-next aria-label="Move to next page" title="Move to next page">&#9658;</button>
    <button type="button" class="btn btn-sm btn-outline" data-move-up aria-label="Move up">&#8593;</button>
    <button type="button" class="btn btn-sm btn-outline" data-move-down aria-label="Move down">&#8595;</button>
    <button type="button" class="btn btn-sm btn-danger" data-remove-section aria-label="Remove">Remove</button>
  </span>`;
}

// The FIXED-slot inner row. Its opening tag is byte-preserved from v2.4
// (`<div class="lg-section-row lg-structure-row" data-section-id data-section-
// public-id>`) — the collectSections()/slideStillPresent() readers + the seam
// harness's SSR-row regex both anchor on it, and the preview click-select reads
// data-section-public-id off it.
function renderSectionRow(
  sectionId: number | string,
  sectionPublicId: string,
  name: string,
  vertical: string,
  position: number,
  _isAuctionEntry: boolean,
  mappingStatus?: string,
): string {
  const dot = mappingDotStatus(mappingStatus);
  return `<div class="lg-section-row lg-structure-row" data-section-id="${sectionId}" data-section-public-id="${escapeHtml(sectionPublicId)}">
  <div class="lg-slot-line">
  <span class="lg-drag-handle" data-drag-handle draggable="true" title="Drag to reorder" aria-hidden="true">&#8942;&#8942;</span>
  <span class="lg-pos" data-pos>${position}</span>
  <span class="lg-map-dot" data-mapping-status="${dot}" title="${escapeHtml(MAPPING_DOT_TITLES[dot])}"></span>
  <span class="lg-grow lg-name-cell" data-name-cell><button type="button" data-select-slide data-section-name>${escapeHtml(name)}</button></span>
  <span class="form-help lg-vertical" data-vertical>${escapeHtml(vertical)}</span>
  </div>
  ${slotRail("fixed")}
</div>`;
}

// A/B candidate row: a section ref + a percent (bp/100). Σ across a slot's
// candidates must be 100% (validated at save; the live sum note updates client-
// side). data-ab-cand marks the row for collectPages.
function renderAbCandidate(available: AvailableSection[], entry: AbEntryNode | null): string {
  const pct = entry !== null ? (entry.bp / 100).toString() : "50";
  return `<div class="lg-ab-cand" data-ab-cand>
    <select class="form-select form-select-sm lg-grow" data-ab-section aria-label="A/B candidate section">${sectionRefOptions(available, entry?.section_id ?? "")}</select>
    <input type="number" class="form-input form-input-sm lg-pct" data-ab-pct min="0" max="100" step="1" value="${escapeHtml(pct)}" aria-label="Percent of traffic" />
    <span class="lg-pct-unit">%</span>
    <button type="button" class="btn btn-sm btn-outline" data-ab-cand-remove aria-label="Remove candidate">&#215;</button>
  </div>`;
}

// A/B slot body: the summary chip + the split editor. data-slot-kind="ab".
function renderAbSlot(available: AvailableSection[], entries: AbEntryNode[], slotRevision: number): string {
  const rows = (entries.length > 0 ? entries : [null, null])
    .map((e) => renderAbCandidate(available, e))
    .join("");
  const sum = entries.reduce((acc, e) => acc + e.bp, 0);
  return `<div class="lg-slot" data-slot data-slot-kind="ab" data-slot-revision="${slotRevision}">
    <div class="lg-slot-row lg-structure-row">
      <div class="lg-slot-line">
        <span class="lg-slot-badge">A/B</span>
        <span class="lg-grow lg-name-cell lg-slot-summary" data-slot-summary>Split traffic between sections</span>
      </div>
      ${slotRail("ab")}
    </div>
    <div class="lg-slot-config" data-ab-editor>
      <p class="form-help">Each visitor sticks to one section for their whole session. Percentages must add up to 100%.</p>
      <div data-ab-cands>${rows}</div>
      <div class="toolbar">
        <button type="button" class="btn btn-sm btn-secondary" data-ab-add>+ Add candidate</button>
        <span class="form-help" data-ab-sum>Total: ${entries.length > 0 ? (sum / 100).toString() : "0"}%</span>
      </div>
    </div>
  </div>`;
}

// Ruled case row: one entry-known condition (field/op/value) → a section.
function renderRuledCase(available: AvailableSection[], c: RuledCaseNode | null): string {
  const g = c !== null && Array.isArray(c.conditions.groups) ? (c.conditions.groups[0] as { field?: string; op?: string; value?: string } | undefined) : undefined;
  return `<div class="lg-ruled-case" data-ruled-case>
    <span class="lg-ruled-if">If</span>
    <select class="form-select form-select-sm" data-ruled-field aria-label="Condition field">${ruledFieldOptions(g?.field ?? "state")}</select>
    <select class="form-select form-select-sm" data-ruled-op aria-label="Condition operator">${ruledOpOptions(g?.op ?? "eq")}</select>
    <input type="text" class="form-input form-input-sm" data-ruled-value value="${escapeHtml(g?.value ?? "")}" aria-label="Condition value" placeholder="value" />
    <span class="lg-ruled-then">show</span>
    <select class="form-select form-select-sm lg-grow" data-ruled-section aria-label="Section for this branch">${sectionRefOptions(available, c?.section_id ?? "")}</select>
    <button type="button" class="btn btn-sm btn-outline" data-ruled-case-remove aria-label="Remove branch">&#215;</button>
  </div>`;
}

// Ruled slot body: ordered cases (first match wins) + a REQUIRED default.
function renderRuledSlot(available: AvailableSection[], ruled: { cases: RuledCaseNode[]; default_section: SectionRef } | null, slotRevision: number): string {
  const cases = (ruled !== null && ruled.cases.length > 0 ? ruled.cases : [null])
    .map((c) => renderRuledCase(available, c))
    .join("");
  return `<div class="lg-slot" data-slot data-slot-kind="ruled" data-slot-revision="${slotRevision}">
    <div class="lg-slot-row lg-structure-row">
      <div class="lg-slot-line">
        <span class="lg-slot-badge">Rule</span>
        <span class="lg-grow lg-name-cell lg-slot-summary" data-slot-summary>Show a section by visitor condition</span>
      </div>
      ${slotRail("ruled")}
    </div>
    <div class="lg-slot-config" data-ruled-editor>
      <p class="form-help">Branch on what's known at entry (state, device, UTM, time). Answer-based visibility lives on the section's own show/hide rules.</p>
      <div data-ruled-cases>${cases}</div>
      <div class="toolbar"><button type="button" class="btn btn-sm btn-secondary" data-ruled-add>+ Add branch</button></div>
      <div class="lg-ruled-default">
        <span class="lg-ruled-otherwise">Otherwise show</span>
        <select class="form-select form-select-sm lg-grow" data-ruled-default aria-label="Default section">${sectionRefOptions(available, ruled?.default_section.section_id ?? "")}</select>
      </div>
    </div>
  </div>`;
}

// A FIXED slot: the section row wrapped so the island reads its kind off the
// wrapper (data-slot). The mapping dot on the inner row comes from the picker's
// per-section verdict on a client-side add.
function renderFixedSlot(ref: SectionRef, slotRevision: number, mappingStatus?: string): string {
  return `<div class="lg-slot" data-slot data-slot-kind="fixed" data-slot-revision="${slotRevision}">${renderSectionRow(
    ref.num_id === undefined ? "" : ref.num_id,
    ref.section_id,
    ref.section_name,
    "",
    0,
    false,
    mappingStatus,
  )}</div>`;
}

function renderSlot(available: AvailableSection[], slot: PageSlotNode, mappingByPublic: Map<string, string>): string {
  if (slot.kind === "ab" && slot.ab !== null) return renderAbSlot(available, slot.ab, slot.slot_revision);
  if (slot.kind === "ruled" && slot.ruled !== null) return renderRuledSlot(available, slot.ruled, slot.slot_revision);
  const ref = slot.fixed ?? { section_id: "", section_name: "" };
  return renderFixedSlot(ref, slot.slot_revision, mappingByPublic.get(ref.section_id));
}

function renderPageCard(available: AvailableSection[], page: PageNode, index: number, mappingByPublic: Map<string, string>): string {
  const slots = page.slots.map((s) => renderSlot(available, s, mappingByPublic)).join("");
  return `<div class="lg-page" data-page>
    <div class="lg-page-head">
      <span class="lg-page-num" data-page-num>${index + 1}</span>
      <input class="form-input lg-page-name" data-page-name value="${escapeHtml(page.name ?? "")}" placeholder="Page name (optional)" aria-label="Page name" />
      <span class="lg-row-rail">
        <button type="button" class="btn btn-sm btn-outline" data-page-up aria-label="Move page up">&#8593;</button>
        <button type="button" class="btn btn-sm btn-outline" data-page-down aria-label="Move page down">&#8595;</button>
        <button type="button" class="btn btn-sm btn-danger" data-page-remove aria-label="Remove page">Remove</button>
      </span>
    </div>
    <div class="lg-page-slots" data-page-slots>${slots}</div>
    <div class="lg-page-add toolbar">
      <select class="form-select form-select-sm lg-grow" data-add-slot-select aria-label="Add a section to this page">${sectionAddOptions(available)}</select>
      <button type="button" class="btn btn-sm btn-secondary" data-add-slot>+ Add section</button>
    </div>
  </div>`;
}

// A plain single-section-per-page funnel (no page names, every slot a single
// fixed section) still reads as a flat list of "slides"; the "page" vocabulary
// only earns its place once a page holds more than one slot or a ruled / A/B
// slot. Drives the auction-marker copy (mirrored by the client renumber()).
function pagesAreFlat(pages: PageNode[]): boolean {
  if (pages.length === 0) return false;
  return pages.every((p) => (p.name === null || p.name === "") && p.slots.length === 1 && (p.slots[0]?.kind ?? "fixed") === "fixed");
}

// Funnel structure (left): ordered PAGES, each a first-class row holding its
// nested section slots (fixed / ruled / A/B). Progress counts pages; the
// auction runs after the LAST page. The A/B arms mini switcher + Rules link +
// the PRESERVED variant scalars (lander / base design / auction FK) ride below,
// their ids + the §4.7 save path unchanged.
function renderStructurePanel(
  structure: StructureBody,
  variant: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
): string {
  const designOptions = designs
    .map((d) => `<option value="${escapeHtml(d.id)}"${d.id === variant.funnel_design_id ? " selected" : ""}>${escapeHtml(d.label)}</option>`)
    .join("");
  const auctionOptions = [`<option value="">— none —</option>`]
    .concat(
      auctions.map(
        (a) => `<option value="${a.id}"${variant.auction_id === a.id ? " selected" : ""}>${escapeHtml(a.auction_name)}</option>`,
      ),
    )
    .join("");
  const addOptions = sectionAddOptions(available);

  // The mapping verdict is a per-section list attribute; index it by public id
  // so a rendered fixed slot shows the same dot the old flat list did.
  const mappingByPublic = new Map<string, string>();
  for (const s of variant.sections) if (s.mapping_status !== undefined) mappingByPublic.set(s.section_public_id, s.mapping_status);

  const pages = variant.pages ?? [];
  const pageCards = pages.map((p, i) => renderPageCard(available, p, i, mappingByPublic)).join("");
  // §15.3 honesty copy: exactly ONE auction-entry marker, after the LAST page
  // (progress counts pages, so the auction fires once every page is passed).
  // A plain single-section-per-page funnel keeps the historical "slide"
  // vocabulary (a page IS one slide there); the "last page" copy takes over
  // once the funnel genuinely branches into multi-slot / ruled / A/B pages. The
  // client renumber() mirrors this EXACT decision (structureIsFlatDom), so the
  // SSR and post-mutation marker never disagree.
  const auctionMark = pages.length > 0
    ? `<div class="lg-auction-entry-mark" data-auction-entry="1">${pagesAreFlat(pages) ? "Auction runs after this slide" : "Auction runs after the last page"}</div>`
    : "";
  const listBody = pageCards
    ? pageCards + auctionMark
    : `<p class="form-help" data-empty-sections>No pages yet — add a page to start building the funnel.</p>`;

  const funnel =
    structure.funnels.find((f) => f.funnel_id === variant.funnel_id) ?? structure.funnels[0] ?? null;
  const armRows = (funnel?.variants ?? [])
    .map((v) => {
      const pct = (v.traffic_allocation_bp / 100).toFixed(0);
      const current = v.public_id === variant.public_id;
      return `<div class="lg-structure-row${current ? " lg-slide-current" : ""}" data-arm-row="${escapeHtml(v.public_id)}">
    <a class="lg-grow" href="/admin/leadgen/quotes/${escapeHtml(structure.quote.public_id)}/edit?variant=${escapeHtml(v.public_id)}">${escapeHtml(v.variant_label)}</a>
    <span class="form-help">${escapeHtml(pct)}%</span>
  </div>`;
    })
    .join("");

  return `<div class="lg-studio-left">
  <div class="lg-panel-card" id="lg-structure-panel">
    <h3>Funnel structure</h3>
    <p class="form-help lg-structure-hint">Each page is one step of the funnel. Progress counts pages, and the auction runs once every page is passed.</p>
    <div id="lg-section-list" data-max-position="${variant.auction_entry_position === null ? "" : variant.auction_entry_position}">${listBody}</div>
    <div class="toolbar">
      <select id="lg-add-section-select" class="form-select" aria-label="Add a section as a new page">${addOptions || `<option value="">No sections for this activity</option>`}</select>
      <button type="button" id="lg-add-section" class="btn btn-secondary">+ Add section</button>
      <button type="button" id="lg-add-page" class="btn btn-outline">+ Add page</button>
    </div>
  </div>
  <div class="lg-panel-card" id="lg-ab-switcher">
    <h3>A/B variants</h3>
    ${armRows || `<p class="form-help">One arm.</p>`}
    <button type="button" class="lg-qtab" data-goto-tab="ab">Manage allocation &amp; tests &#8594;</button>
    <button type="button" class="lg-qtab" data-goto-tab="rules">Rules for this variant &#8594;</button>
  </div>
  <details class="lg-advanced" id="lg-funnel-settings">
    <summary>Funnel settings</summary>
    <label class="lg-check"><input type="checkbox" id="lg-lander-enabled"${variant.lander_enabled ? " checked" : ""} /> Enable opening lander</label>
    <div class="form-group"><label class="form-label" for="lg-lander-headline">Lander headline</label><input id="lg-lander-headline" class="form-input" value="${escapeHtml(variant.lander_headline ?? "")}" /></div>
    <div class="form-group"><label class="form-label" for="lg-lander-sub">Lander subheadline</label><input id="lg-lander-sub" class="form-input" value="${escapeHtml(variant.lander_subheadline ?? "")}" /></div>
    <div class="form-group"><label class="form-label" for="lg-lander-hero">Lander hero image URL</label><input id="lg-lander-hero" class="form-input" value="${escapeHtml(variant.lander_hero_media_url ?? "")}" /></div>
    <div class="form-group"><label class="form-label" for="lg-funnel-design">Base visual design</label><select id="lg-funnel-design" class="form-select" aria-label="Funnel design">${designOptions}</select></div>
    <div class="form-group"><label class="form-label" for="lg-auction-id">Auction</label><select id="lg-auction-id" class="form-select" aria-label="Auction">${auctionOptions}</select></div>
  </details>
  <template id="lg-page-tpl">${renderPageCard(available, { name: null, slots: [] }, 0, new Map())}</template>
  <template id="lg-slot-fixed-tpl">${renderFixedSlot({ section_id: "", section_name: "" }, 0)}</template>
  <template id="lg-slot-ab-tpl">${renderAbSlot(available, [], 0)}</template>
  <template id="lg-slot-ruled-tpl">${renderRuledSlot(available, null, 0)}</template>
  <template id="lg-ab-cand-tpl">${renderAbCandidate(available, null)}</template>
  <template id="lg-ruled-case-tpl">${renderRuledCase(available, null)}</template>
</div>`;
}

// --- canvas toolbar + canvas (§4.1 center) -----------------------------------

function renderSiteSelect(id: string, sites: PreviewSiteOption[]): string {
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

function renderTemplatePicker(templates: FrameTemplateItem[]): string {
  const cards = templates
    .map(
      (t) => `<button type="button" class="lg-template-card" data-template-pick="${escapeHtml(t.id)}" title="${escapeHtml(t.arrangement)}">
    ${t.thumbnail_html}
    <span>${escapeHtml(t.label)}</span>
  </button>`,
    )
    .join("");
  // Round-4 P5b DELIBERATE NON-MOVE (reported conflict — see the phase
  // report): the operator restructure spec's "Templates tab" is defined
  // (deliverable 2) as the SEVEN box pickers only. Moving THIS pre-existing
  // 6-arrangement picker out of the canvas toolbar breaks the PROVEN
  // "preview-before-apply shows on the SAME visible canvas" contract two
  // rows of test-ui/leadgen-quote-builder.spec.ts depend on (② and ⑥ —
  // verified failing when this card is hidden behind an inactive tab). It
  // stays canvas-embedded, `#lg-template-btn` keeps its EXISTING inline
  // toggle (unchanged) — only the SEVEN NEW boxes live in the Templates tab.
  return `<div class="lg-panel-card lg-hidden" id="lg-template-picker">
  <h3>Funnel layout template</h3>
  <p class="form-help">Your copy, images and colors are kept. Layout comes from the template. Nothing changes until you Save.</p>
  <div class="lg-template-grid">${cards || `<p class="form-help">No templates available.</p>`}</div>
  <div class="lg-hidden" id="lg-template-confirm">
    <h3>Before you switch</h3>
    <ul id="lg-template-confirm-list"></ul>
    <div class="toolbar">
      <button type="button" class="btn btn-primary" id="lg-template-apply">Switch template</button>
      <button type="button" class="btn btn-outline" id="lg-template-cancel">Cancel</button>
    </div>
  </div>
</div>`;
}

function renderCanvasPanel(templates: FrameTemplateItem[], sites: PreviewSiteOption[], structure: StructureBody, selected: VariantNode): string {
  const variantOptions: string[] = [];
  for (const f of structure.funnels) {
    for (const v of f.variants) {
      variantOptions.push(
        `<option value="${escapeHtml(v.public_id)}"${v.public_id === selected.public_id ? " selected" : ""}>${escapeHtml(v.variant_label)}</option>`,
      );
    }
  }
  return `<div class="lg-studio-center">
  <div class="lg-canvas-toolbar" id="lg-canvas-toolbar">
    <button type="button" class="btn btn-sm btn-secondary" id="lg-template-btn">Template</button>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-theme-btn">Theme</button>
    <span class="lg-toolbar-sep" aria-hidden="true"></span>
    <span class="lg-step-controls" role="group" aria-label="Viewport">
      <button type="button" class="btn btn-sm btn-outline" data-viewport-btn="desktop" aria-pressed="true">Desktop 1280</button>
      <button type="button" class="btn btn-sm btn-outline" data-viewport-btn="mobile" aria-pressed="false">Mobile 375</button>
    </span>
    <span class="lg-toolbar-sep" aria-hidden="true"></span>
    <span class="lg-step-controls" role="group" aria-label="Preview mode">
      <button type="button" class="btn btn-sm btn-outline" data-preview-mode-btn="section" aria-pressed="true">Current slide</button>
      <button type="button" class="btn btn-sm btn-outline" data-preview-mode-btn="all" aria-pressed="false">Step through all slides</button>
    </span>
    <span class="lg-step-controls lg-hidden" id="lg-step-controls">
      <button type="button" class="btn btn-sm btn-outline" id="lg-step-prev" aria-label="Previous slide">&#8592;</button>
      <span class="form-help" id="lg-step-label">Slide 1</span>
      <button type="button" class="btn btn-sm btn-outline" id="lg-step-next" aria-label="Next slide">&#8594;</button>
    </span>
    <span class="lg-toolbar-sep" aria-hidden="true"></span>
    ${renderSiteSelect("lg-canvas-site-select", sites)}
    <select id="lg-canvas-variant-select" class="form-select" aria-label="Preview variant">${variantOptions.join("")}</select>
  </div>
  ${renderTemplatePicker(templates)}
  <div class="lg-chip lg-override-badge lg-hidden" id="lg-override-badge">Variant overrides: <strong id="lg-override-badge-list"></strong></div>
  <div class="lg-slot-banner lg-hidden" id="lg-slot-banner" role="status">
    <span>This area is the Section&#8217;s question unit &#8212; edit it in the Section Builder</span>
    <a class="btn btn-sm btn-secondary" id="lg-slot-banner-open" href="#">Open Section</a>
  </div>
  <div class="lg-canvas-wrap" id="lg-canvas-wrap">
    <iframe id="lg-preview-iframe" class="lg-frame-canvas" title="Funnel layout preview" sandbox="allow-same-origin"></iframe>
  </div>
  <p class="form-help" id="lg-canvas-status" role="status"></p>
</div>`;
}

// --- theme editor (09 §9.3) ---------------------------------------------------

// DEV-60 (d), 09 §9.3 — the curated harmony steps per role-edit control:
// base value + wash / darker / lighter steps DERIVED from the base design's
// value (island mix math paints the chips; labels only, never hex text).
// "Base" writes the ROLE-VALUE alias; derived steps are custom values and
// flow through the Advanced custom-color path (same storage + warning
// semantics), never a silent bypass.
const HARMONY_STEPS: ReadonlyArray<{ step: string; label: string }> = [
  { step: "base", label: "Base" },
  { step: "wash", label: "Soft wash" },
  { step: "darker", label: "Darker" },
  { step: "lighter", label: "Lighter" },
];

function renderHarmonyRow(role: string): string {
  const buttons = HARMONY_STEPS.map(
    (s) =>
      `<button type="button" class="lg-harmony-step" data-harmony-role="${escapeHtml(role)}" data-harmony-step="${escapeHtml(s.step)}"><span class="lg-harmony-chip" data-harmony-chip aria-hidden="true"></span>${escapeHtml(s.label)}</button>`,
  ).join("");
  return `<div class="lg-harmony-row" data-harmony-row="${escapeHtml(role)}">${buttons}</div>`;
}

// P6b (deliverable 2) — proper-case labels for the FULL THEME_FONT_IDS
// vocabulary. P6a widened THEME_FONT_IDS from the 3 back-compat ids
// (literata/sora/system) to 11 (+8 curated self-hosted families, theme.ts
// THEME_FONT_STACKS doc comment) — enumOptions() already falls back to a
// de-underscored raw id when no label is given (e.g. "space grotesk"), so
// this map exists purely to give every option a polished human label,
// extending the pre-existing 3-id inline label the two font selects used.
const THEME_FONT_LABELS: Readonly<Record<string, string>> = {
  literata: "Literata",
  sora: "Sora",
  system: "System",
  poppins: "Poppins",
  space_grotesk: "Space Grotesk",
  fraunces: "Fraunces",
  playfair: "Playfair Display",
  manrope: "Manrope",
  dm_sans: "DM Sans",
  work_sans: "Work Sans",
  lexend: "Lexend",
};

function renderThemeEditorPanel(isControl: boolean): string {
  const paletteRows = ROLE_META.map(
    (r) => `<div class="lg-theme-role-row" data-theme-role="${escapeHtml(r.role)}">
    <span class="lg-theme-swatch" data-role-swatch aria-hidden="true"></span>
    <span class="lg-grow"><strong>${escapeHtml(r.label)}</strong><br /><span class="lg-used-by">Used by: ${escapeHtml(r.used_by)}</span></span>
    <span class="lg-inherit-tag" data-role-source>Base design</span>
    <details class="lg-theme-edit"><summary class="form-help">Edit</summary>
      <p class="form-help">Suggested from this design&#8217;s base value:</p>
      ${renderHarmonyRow(r.role)}
      <p class="form-help">Or pick a color from this design&#8217;s palette:</p>
      ${renderRoleStrip(`palette.${r.role}`)}
      <button type="button" class="btn btn-sm btn-outline" data-role-reset="${escapeHtml(r.role)}">Reset to inherited</button>
    </details>
  </div>`,
  ).join("");

  const themeSelect = (label: string, key: string, values: readonly string[], labels?: Readonly<Record<string, string>>): string =>
    `<div class="form-group"><label class="form-label">${escapeHtml(label)}</label><select class="form-select" data-theme-key="${escapeHtml(key)}"><option value="">Inherit from base design</option>${enumOptions(values, labels)}</select></div>`;

  // Round-4 P5b: lives inside the new "Themes" top tab now (moved out of the
  // canvas toolbar) — the tab panel wrapper owns visibility.
  return `<div class="lg-panel-card" id="lg-theme-editor">
  <h3>Funnel theme</h3>
  <div class="lg-scope-head">Editing: <strong>Funnel theme</strong> · affects every slide and every component default of this funnel</div>
  ${renderOverrideSwitch("theme", isControl)}
  <div class="lg-theme-minipreview" id="lg-theme-minipreview" data-mini-preview-mode="frame">
    <iframe id="lg-theme-minipreview-frame" class="lg-minipreview-frame" title="Theme mini preview" sandbox="allow-same-origin"></iframe>
    <p class="form-help" id="lg-theme-minipreview-status" role="status"></p>
  </div>
  <h3>Colors</h3>
  <div id="lg-theme-palette">${paletteRows}</div>
  <h3>Typography</h3>
  <p class="form-help">Display sets headlines, big numbers and the display size below. Body sets paragraphs, labels and inputs — the two never share a size or a font by accident.</p>
  <div class="lg-scalars">
    ${themeSelect("Display font (headlines)", "typography.display", THEME_FONT_IDS, THEME_FONT_LABELS)}
    ${themeSelect("Body font (paragraphs)", "typography.body", THEME_FONT_IDS, THEME_FONT_LABELS)}
    ${themeSelect("Body text size", "typography.size", THEME_SIZE_SCALES, { s: "Small", m: "Medium", l: "Large" })}
    ${themeSelect("Display size", "typography.display_size", THEME_DISPLAY_SIZE_SCALES, { m: "Base", l: "Large", xl: "X-Large", xxl: "XX-Large" })}
  </div>
  <h3>Scales</h3>
  <div class="lg-scalars">
    ${themeSelect("Spacing", "scales.spacing", THEME_SPACING_SCALES, { compact: "Compact", regular: "Regular", roomy: "Roomy" })}
    ${themeSelect("Corners", "scales.radius", THEME_RADIUS_SCALES, { sharp: "Sharp", soft: "Soft", round: "Round" })}
    ${themeSelect("Shadows", "scales.shadow", THEME_SHADOW_SCALES, { none: "None", low: "Low", mid: "Mid", high: "High" })}
  </div>
  <h3>Buttons</h3>
  ${frameControl("Button background", renderRoleStrip("theme:button_defaults.background_role"))}
  ${frameControl("Button text", renderRoleStrip("theme:button_defaults.text_role"))}
  <div class="lg-scalars">
    ${themeSelect("Button corners", "button_defaults.radius", THEME_RADIUS_STEPS)}
    ${themeSelect("Button height", "button_defaults.min_height", ["m", "l"], { m: "Medium", l: "Large" })}
    ${themeSelect("Button casing", "button_defaults.casing", ["none", "upper"], { none: "As written", upper: "UPPERCASE" })}
  </div>
  <h4>Button style</h4>
  <p class="form-help">Three independent looks (Images 38&#8211;40) &#8212; mix and match; each defaults to today's look.</p>
  <div class="lg-scalars">
    ${themeSelect("Fill", "button_defaults.fill", THEME_BUTTON_STYLES, { fill: "Solid (default)", outline: "Outline", soft: "Soft pill + shadow" })}
    ${themeSelect("Answer layout", "button_defaults.layout", THEME_BUTTON_LAYOUTS, { grid: "Grid (default)", list: "Single-column list" })}
    ${themeSelect("Selected style", "button_defaults.selected", THEME_BUTTON_SELECTED_STYLES, { wash: "Soft wash (default)", mark: "Bigger + check badge" })}
  </div>
  <h3>Cards</h3>
  ${frameControl("Card background", renderRoleStrip("theme:card_defaults.background_role"))}
  ${frameControl("Card border", renderRoleStrip("theme:card_defaults.border_role"))}
  <div class="lg-scalars">
    ${themeSelect("Card corners", "card_defaults.radius", THEME_RADIUS_STEPS)}
    ${themeSelect("Card shadow", "card_defaults.shadow", THEME_SHADOW_STEPS)}
  </div>
  <details class="lg-advanced" id="lg-theme-advanced">
    <summary>Advanced token administration</summary>
    <p class="form-help">Custom colors skip the design system &#8212; check contrast.</p>
    <div class="lg-list-row">
      <select class="form-select" id="lg-theme-hex-role">${ROLE_META.map((r) => `<option value="${escapeHtml(r.role)}">${escapeHtml(r.label)}</option>`).join("")}</select>
      <input class="form-input" id="lg-theme-hex-value" placeholder="Custom color value" />
      <button type="button" class="btn btn-sm btn-secondary" id="lg-theme-hex-apply">Apply</button>
    </div>
  </details>
</div>`;
}

// ---------------------------------------------------------------------------
// P6b (deliverables 3+4) — PRESETS: the KV `lg-funnel-themes` catalog
// (themes-handlers.ts CRUD), surfaced inline in the SAME Themes tab. Full
// list/create/edit/delete already exists as the standalone Themes-manager
// page (ui-theme-manager.ts) — embedded here via its OWN `?embed=1`
// chromeless mode, the SAME mechanism Section Studio already uses to overlay
// it (ui-section-studio.ts's `#lg-themes-overlay-frame`), so this reuses
// 100% of its rendering/CRUD/delete-guard UI rather than duplicating any of
// it ("Reuse ui-theme-manager's existing editor internals" — the whole page
// IS its internals). This panel adds ONLY what that page cannot do on its
// own: a picker to APPLY a saved preset to THIS funnel/variant (a per-funnel
// ThemeIdRef picker), and the theme A/B one-click fork.
// ---------------------------------------------------------------------------

function renderThemePresetsPanel(): string {
  return `<div class="lg-panel-card" id="lg-theme-presets">
  <h3>Theme presets</h3>
  <p class="form-help">Save the current look as a reusable preset from the panel below (its own "New theme" button), then apply or delete any preset here. Presets are shared across every funnel.</p>
  <div class="lg-preset-apply-row">
    <select class="form-select" id="lg-theme-preset-select" aria-label="Theme preset"><option value="">Loading presets&#8230;</option></select>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-theme-preset-apply">Apply to this funnel</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-theme-ab-this" title="Fork this variant with the picked preset as its theme, then set the traffic split">A/B this theme</button>
  </div>
  <iframe id="lg-theme-presets-frame" class="lg-theme-presets-frame" title="Theme presets manager" src="/admin/leadgen/themes?embed=1"></iframe>
</div>`;
}

function renderThemesTabPanel(isControl: boolean): string {
  // Round-4 P5b deliverable 1: a CLEAN mount point — P6b replaces the panel
  // BODY (renderThemeEditorPanel's internals) without touching this tab's
  // chrome (the tab button + this wrapper div stay byte-stable across P6b).
  return `<div class="lg-qpanel" data-panel="themes">
  <div id="lg-themes-panel-mount">${renderThemeEditorPanel(isControl)}</div>
  ${renderThemePresetsPanel()}
</div>`;
}

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
function renderTemplatesTabPanel(isControl: boolean, answerFields: RoutingBuilderData["fields"]): string {
  void isControl; // reserved: no per-arm override switch on the P5a element groups (funnel-wide only) — see the section header doc comment.
  return `<div class="lg-qpanel" data-panel="templates">
  ${renderTemplateBoxPickers(answerFields)}
</div>`;
}

// --- the assembled §4.1 Funnel-builder panel ----------------------------------

function renderBuilderPanel(
  structure: StructureBody,
  variant: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
  templates: FrameTemplateItem[],
  sites: PreviewSiteOption[],
  routingData: RoutingBuilderData,
): string {
  // Rework M1 replacement semantics — see primaryVariantOf's doc comment.
  const ownFunnel = structure.funnels.find((f) => f.funnel_id === variant.funnel_id) ?? null;
  const isControl = primaryVariantOf(ownFunnel?.variants ?? [variant])?.public_id === variant.public_id;
  return `<div class="lg-qpanel active" data-panel="builder">
  <div class="lg-studio" id="lg-frame-studio">
    ${renderStructurePanel(structure, variant, designs, auctions, available)}
    ${renderCanvasPanel(templates, sites, structure, variant)}
    ${renderInspectorColumn(isControl, variant, routingData)}
  </div>
</div>`;
}

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

// Round-4 P4b: this row is now a HIDDEN wire-format carrier — the unified
// routing-rules table/modal (ui-rules-builder.ts renderRoutingRulesPanel +
// ROUTING_RULES_SCRIPT) is the operator-facing surface, reading/writing these
// SAME fields by row index. The legacy VISIBLE grid (raw rule-type select +
// bare integer target_offer_id input) is wrapped `lg-hidden` rather than
// deleted, so byte-for-byte the SAME [data-rule-*] selectors + Advanced/
// textarea structure survive for collectRules() and the pre-existing pinned
// tests (test/leadgen-quotes-ui.test.ts, test/leadgen-quote-builder-ui.test.ts,
// test/leadgen-quote-builder-seam.test.ts) — see the P4b report's re-pin/
// preservation list. NO operator ever sees or types a raw integer id: the
// modal's by-NAME pickers are what actually drive these hidden values.
function renderRuleRow(rule: RuleNode | null, index = -1, targetVariantPublicId = ""): string {
  // Rework M3 (§5-M3, D5): leadgen_funnel_rules' CHECK is now tightened to
  // exactly these four auction-domain types — route_funnel_variant rows
  // migrated to the new quote-scoped leadgen_quote_routing_rules (P3b UI),
  // skip_section/show_section rows are guarded off (never exist post-
  // migration). Offering a removed type here would let a save attempt hit
  // the DB CHECK.
  const ruleTypes = ["redirect_direct_offer", "eligibility", "disqualification", "auction_entry"];
  const selectedType = rule?.rule_type ?? "eligibility";
  const typeOptions = ruleTypes
    .map((t) => `<option value="${t}"${t === selectedType ? " selected" : ""}>${t}</option>`)
    .join("");
  const conditions = rule ? JSON.stringify(rule.conditions_json ?? { groups: [] }) : `{"groups":[]}`;
  // The FIRST SSR'd row's conditions carrier gets the stable id the B3 panel's
  // data-target-input names (template clones carry only the data attribute).
  const condId = index === 0 ? ' id="lg-rule-conditions"' : "";
  const status = rule?.status === "disabled" ? "disabled" : "active";
  const matchMode = rule?.match_mode === "any" ? "any" : "all";
  return `<div class="lg-rule-row" data-rule-row>
  <div class="lg-rule-grid lg-hidden">
    <div class="form-group"><label class="form-label">Rule type</label><select class="form-select" data-rule-type>${typeOptions}</select></div>
    <div class="form-group"><label class="form-label">Target offer id (redirect_direct_offer)</label><input class="form-input" data-rule-target-offer value="${rule?.target_offer_id ?? ""}" /></div>
    <div class="form-group"><label class="form-label">Priority</label><input class="form-input" data-rule-priority value="${rule?.priority ?? 100}" /></div>
  </div>
  <div class="lg-rule-grid lg-hidden">
    <div class="form-group"><label class="form-label">Raw redirect URL (allowlist-gated)</label><input class="form-input" data-rule-redirect-url value="${escapeHtml(rule?.redirect_url ?? "")}" /></div>
    <div class="form-group"><label class="lg-check"><input type="checkbox" data-rule-allowlisted${rule?.redirect_url_allowlisted ? " checked" : ""} /> Redirect URL is on the approved list</label></div>
    <div class="form-group"><label class="lg-check"><input type="checkbox" data-rule-enabled${rule === null || rule.enabled ? " checked" : ""} /> enabled</label></div>
  </div>
  <div class="lg-rule-grid lg-hidden">
    <input class="form-input" type="text" data-rule-name value="${escapeHtml(rule?.rule_name ?? "")}" />
    <input class="form-input" type="text" data-rule-status value="${escapeHtml(status)}" />
    <input class="form-input" type="text" data-rule-match-mode value="${escapeHtml(matchMode)}" />
    <input class="form-input" type="text" data-rule-target-section value="${rule?.target_section_id ?? ""}" />
    <input class="form-input" type="text" data-rule-target-variant value="${escapeHtml(targetVariantPublicId)}" />
    <input class="form-input" type="text" data-rule-value-multiplier value="${rule?.value_multiplier ?? ""}" />
    <input class="form-input" type="text" data-rule-redirect-pct value="${rule?.redirect_pct ?? ""}" />
  </div>
  <details class="lg-advanced"><summary>Advanced &#8212; raw conditions (visual builder pending)</summary>
    <textarea class="form-input"${condId} data-rule-conditions rows="2">${escapeHtml(conditions)}</textarea>
  </details>
  <button type="button" class="btn btn-sm btn-danger" data-remove-rule>Remove rule</button>
</div>`;
}

// Round-4 P4b: renders the unified routing-rules table + Image42-shaped
// modal (ui-rules-builder.ts renderRoutingRulesPanel) alongside the hidden
// per-rule wire-format rows (renderRuleRow) collectRules() reads. `data`
// carries the SAME funnel's variants (route-target picker scope), the
// activity's Sections/Offers (by-NAME action pickers), the combined field
// registry, and the field->page checkpoint-mirror map (buildFieldPageMap).
function renderRulesPanel(variant: VariantNode, routingData: RoutingBuilderData): string {
  // target_funnel_variant_id (an internal numeric id, per ruleRowToApi's read
  // shape) is resolved here to its PUBLIC id so the hidden data-rule-target-
  // variant carrier round-trips through the modal's by-NAME <select> (whose
  // <option> values ARE public ids — see numericRefOptions/variantRefOptions
  // in ui-rules-builder.ts) — never a raw integer the operator could see.
  const variantIdToPublic = new Map<number, string>(routingData.variants.map((v) => [v.id, v.public_id]));
  const rows = variant.rules
    .map((r, i) => renderRuleRow(r, i, r.target_funnel_variant_id != null ? (variantIdToPublic.get(r.target_funnel_variant_id) ?? "") : ""))
    .join("");
  // The ORIGINAL B3 condition-cluster builder (renderRulesBuilderPanel/
  // RULES_BUILDER_SCRIPT) is kept mounted, HIDDEN, purely for wire/test
  // compatibility: test/leadgen-quote-builder-ui.test.ts pins id="lg-rules-
  // builder-root" / id="lg-rules-builder-data" / data-target-input="lg-rule-
  // conditions" being present in the SSR'd HTML (a raw substring check, not a
  // visibility check) — a file outside this slice's ownership. The operator
  // never sees or uses this instance; the unified modal above mounts its OWN
  // FRESH window.lgRulesBuilder.mount() call per edit (ui-rules-builder.ts
  // ROUTING_RULES_SCRIPT openModalFor), targeting the SAME [data-rule-
  // conditions] carrier directly. `offers` is deliberately [] here (this
  // hidden instance's decorative offer-name chip is inert — ui-quotes.ts
  // never fed it real offer names even before P4b).
  const legacyBuilderData: RulesBuilderData = {
    rules: variant.rules.map((r) => r.conditions_json ?? { groups: [] }),
    fields: routingData.fields,
    offers: [],
  };
  return `${renderRoutingRulesPanel(routingData)}
  <div class="lg-hidden" data-rules-hidden-rows>
    ${renderRulesBuilderPanel(legacyBuilderData)}
    <div class="toolbar"><button type="button" id="lg-add-rule" class="btn btn-secondary">+ Add rule</button></div>
    <p class="form-help">redirect_direct_offer uses a target offer (governed URL). A raw redirect URL is honored only when allowlisted AND its host is on the admin allowlist (§15.5).</p>
    <div id="lg-rule-list">${rows || `<p class="form-help" data-empty-rules>No rules.</p>`}</div>
  </div>
  <template id="lg-rule-row-tpl">${renderRuleRow(null)}</template>`;
}

// §4.5 — the operator labels of the groups a sparse frame_overrides_json
// patch overrides (frame groups + `theme` palette; version/template are
// funnel-level and never listed).
function overriddenGroupLabels(overrides: Record<string, unknown> | null): string[] {
  if (overrides === null || typeof overrides !== "object") return [];
  const labels: string[] = [];
  for (const key of Object.keys(overrides)) {
    if (key === "version" || key === "template") continue;
    const value = overrides[key];
    if (value === null || typeof value !== "object" || Object.keys(value as Record<string, unknown>).length === 0) continue;
    labels.push(OVERRIDE_GROUP_LABELS[key] ?? key.replace(/_/g, " "));
  }
  return labels;
}

// P6b (deliverable 5) — per-variant "what varies" summary: the SAME per-arm
// override groups overriddenGroupLabels already exposes (theme/frame keys),
// PLUS whether this arm's template (funnel_design_id), ordered sections, or
// rule set differ from the CONTROL arm — the "whole-quote template-level
// testing" reframe's promised template/theme/sections/rules comparison.
// Structural signature compares only (never content), so a re-ordered
// section list or a renamed rule that changes nothing meaningful still
// reads as "differs" — a coarse but honest (no false-negative) summary.
function sectionSignature(v: VariantNode): string {
  return v.sections.map((s) => s.section_public_id).join(",");
}

function ruleSignature(v: VariantNode): string {
  return v.rules
    .map((r) => `${r.rule_type}:${r.target_offer_id ?? ""}:${r.target_section_id ?? ""}:${r.redirect_url ?? ""}`)
    .sort()
    .join("|");
}

function variantWhatVaries(control: VariantNode, variant: VariantNode): string {
  if (variant.public_id === control.public_id) return "Control";
  const parts: string[] = [];
  if (variant.funnel_design_id !== control.funnel_design_id) parts.push("template");
  const overrideGroups = overriddenGroupLabels(variant.frame_overrides_json);
  if (overrideGroups.length > 0) parts.push(overrideGroups.join(" & "));
  if (sectionSignature(variant) !== sectionSignature(control)) parts.push("sections");
  if (ruleSignature(variant) !== ruleSignature(control)) parts.push("rules");
  return parts.length > 0 ? `Differs from control: ${parts.join(", ")}` : "Same as control (no differences yet)";
}

// A/B panel (§16.2) — per-variant percent allocation (stored as basis points),
// a live Σ indicator, the test lifecycle (create / start / stop), and an
// assignment preview. Scoped to the SELECTED variant's funnel (its arms).
//
// P6b reframe (operator restructure spec): this tab is now presented as
// WHOLE-QUOTE template-level testing, not just a "fork this variant" arm
// manager — "Add variant" (below) forks + immediately prompts the traffic
// split (the SAME §16.2 fork+allocation mechanism "Fork this variant" and
// the Themes tab's "A/B this theme" both use), and every row's what-varies
// line (variantWhatVaries) names what actually differs from control.
function renderAbPanel(structure: StructureBody, selected: VariantNode): string {
  const funnel =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? structure.funnels[0] ?? null;
  const variants = funnel?.variants ?? [];
  // Rework M1 replacement semantics — see primaryVariantOf's doc comment.
  const control = primaryVariantOf(variants);
  const tests = funnel?.ab_tests ?? [];
  const running = tests.find((t) => t.status === "running") ?? null;
  const activeTest = running ?? tests[0] ?? null; // ab_tests are newest-first

  // Per-variant percent input. UI shows % (bp/100); the client stores bp (%*100).
  const allocRows = variants
    .map((v) => {
      const pct = v.traffic_allocation_bp / 100;
      // §4.5 — the overridden frame/theme groups of this arm (sparse
      // frame_overrides_json keys → operator labels).
      const groups = overriddenGroupLabels(v.frame_overrides_json);
      const overridesLine =
        groups.length > 0
          ? `<p class="form-help" data-arm-overrides="${escapeHtml(v.public_id)}">Funnel-layout overrides: ${escapeHtml(groups.join(", "))}</p>`
          : `<p class="form-help" data-arm-overrides="${escapeHtml(v.public_id)}">Same layout as funnel (no overrides)</p>`;
      const varianceLine =
        control !== null
          ? `<p class="form-help" data-arm-variance="${escapeHtml(v.public_id)}">${escapeHtml(variantWhatVaries(control, v))}</p>`
          : "";
      return `<div class="lg-alloc-row" data-variant="${escapeHtml(v.public_id)}">
    <span class="lg-alloc-label"><strong>${escapeHtml(v.variant_label)}</strong></span>
    <label class="lg-alloc-pct"><input type="number" class="form-input lg-alloc-input" data-alloc-input
      data-variant-id="${escapeHtml(v.public_id)}" data-variant-label="${escapeHtml(v.variant_label)}"
      min="0" max="100" step="0.01" value="${escapeHtml(String(pct))}" /> %</label>
    ${overridesLine}
    ${varianceLine}
  </div>`;
    })
    .join("");

  let lifecycle: string;
  if (running !== null) {
    lifecycle = `<span class="lg-ab-status" data-ab-status="running">Running · rev ${running.revision}</span>
      <button type="button" class="btn btn-outline" data-stop-experiment="${escapeHtml(running.public_id)}">Stop A/B test</button>`;
  } else if (activeTest !== null) {
    lifecycle = `<span class="lg-ab-status" data-ab-status="${escapeHtml(activeTest.status)}">${escapeHtml(activeTest.status)} · rev ${activeTest.revision}</span>
      <button type="button" class="btn btn-secondary" data-start-experiment="${escapeHtml(activeTest.public_id)}">Start A/B test</button>`;
  } else {
    lifecycle = `<button type="button" id="lg-create-experiment" class="btn btn-secondary" data-quote-public-id="${escapeHtml(structure.quote.public_id)}">Create A/B test</button>`;
  }

  const preview =
    activeTest !== null
      ? `<div class="card lg-ab-preview">
    <h3>Assignment preview (§16.2)</h3>
    <p class="form-help">Enter a sample session id to see which variant it deterministically buckets to (the same edge hash the runtime serves).</p>
    <div class="lg-ab-preview-row">
      <input type="text" class="form-input" id="lg-ab-preview-session" placeholder="sample ko_sid value" />
      <button type="button" class="btn btn-outline" data-preview-assignment="${escapeHtml(activeTest.public_id)}">Preview assignment</button>
    </div>
    <p class="form-help" id="lg-ab-preview-result" data-ab-preview-result></p>
  </div>`
      : "";

  return `<div class="lg-qpanel" data-panel="ab">
  <div class="card">
    <h3>Traffic allocation (§16.2)</h3>
    <p class="form-help">Test this whole quote against a variant of itself — a different template, theme, sections, or rules. Add a variant, decide what changes on it, then split the traffic below (must sum to <strong>100%</strong>; stored as basis points, per-test Σ == 10000) before a test can start.</p>
    <div id="lg-ab-variant-list" class="lg-alloc-list">${allocRows || `<p class="form-help">No variants.</p>`}</div>
    <p class="lg-alloc-summary">Σ = <strong data-alloc-sum>&mdash;</strong> <span data-alloc-sum-note class="form-help"></span></p>
    <div class="toolbar">
      <button type="button" id="lg-save-allocations" class="btn btn-primary">Save allocations</button>
      <button type="button" id="lg-add-variant" class="btn btn-secondary">Add variant&#8230;</button>
      <button type="button" class="btn btn-outline" data-fork-variant="${escapeHtml(selected.public_id)}">Fork this variant</button>
      ${lifecycle}
    </div>
  </div>
  ${preview}
</div>`;
}

// One 05 §5.2 blocking card — EXACTLY the operator copy pattern:
// "Section: ZIP · Offer: NextInsure · Missing required provider fields:
// current_insurance.carrier, current_insurance.carrier_months ·
// [Open Section Mapping] [Open Offer Payload Schema]".
function renderPreflightBlockCard(b: ActivationPreflightBlock): string {
  const parts: string[] = [];
  if (b.section_name !== "") parts.push(`Section: ${b.section_name}`);
  if (b.offer_name !== "") parts.push(`Offer: ${b.offer_name}`);
  const fields = (b.fields ?? []).map((f) => (b.code === "offer_ineligible" ? eligibilityReasonLabel(f) : f));
  parts.push(preflightCodeLabel(b.code) + (fields.length > 0 ? `: ${fields.join(", ")}` : ""));
  const links: string[] = [];
  if (b.fix_links?.section_mapping !== undefined && b.fix_links.section_mapping !== "") {
    links.push(
      `<a class="btn btn-sm btn-secondary" href="${escapeHtml(b.fix_links.section_mapping)}">Open Section Mapping</a>`,
    );
  }
  if (b.fix_links?.offer_schema !== undefined && b.fix_links.offer_schema !== "") {
    links.push(
      `<a class="btn btn-sm btn-secondary" href="${escapeHtml(b.fix_links.offer_schema)}">Open Offer Payload Schema</a>`,
    );
  }
  return `<div class="lg-preflight-block" data-preflight-code="${escapeHtml(b.code)}"><span>${escapeHtml(parts.join(" · "))}</span>${links.join("")}</div>`;
}

// One 14 §14.2 problem row: severity chip + operator message + the server
// fix_url as a deep link.
function renderProblemRow(p: Problem): string {
  const fixUrl = typeof p.fix_url === "string" ? p.fix_url : "";
  const fix =
    fixUrl !== ""
      ? `<a class="btn btn-sm btn-secondary" href="${escapeHtml(fixUrl)}">${escapeHtml(problemFixLabel(fixUrl))}</a>`
      : "";
  return `<div class="lg-problem-row" data-problem-severity="${escapeHtml(p.severity)}" data-problem-path="${escapeHtml(p.path)}"><span class="lg-problem-chip" data-severity="${escapeHtml(p.severity)}">${p.severity === "error" ? "Error" : "Warning"}</span><span class="lg-problem-msg">${escapeHtml(p.message)}</span>${fix}</div>`;
}

// The 14 §14.2 problems[] section: rows grouped by scope (frame / theme /
// section / component …) in the fixed order, unknown scopes appended.
function renderProblemsSection(problems: Problem[]): string {
  if (problems.length === 0) return "";
  const scopes: string[] = [...PROBLEM_SCOPE_ORDER];
  for (const p of problems) if (!scopes.includes(p.scope)) scopes.push(p.scope);
  const groups = scopes
    .map((scope) => {
      const rows = problems.filter((p) => p.scope === scope);
      if (rows.length === 0) return "";
      return `<div class="lg-problem-group" data-problem-scope="${escapeHtml(scope)}"><h4 class="lg-problem-group-title">${escapeHtml(PROBLEM_SCOPE_LABELS[scope] ?? scope)}</h4>${rows.map(renderProblemRow).join("")}</div>`;
    })
    .filter((g) => g !== "")
    .join("");
  return `<div id="lg-preflight-problems" data-problem-count="${problems.length}">${groups}</div>`;
}

// The 05 §5.2 UI preflight panel body: blocking cards when the server verdict
// fails; green itemized checks when clean; the 14 §14.2 problems[] groups
// appended whenever the additive rows exist (C2 LIVE: an error-severity
// problem is blocking — same rule as the activation PUT's 409).
// Server-verdict-driven only — the same markup the ES5 re-renderer rebuilds
// after variant save / activation PUT (including the 409 report body).
function renderPreflightPanelBody(preflight: ActivationPreflight | null): string {
  if (preflight === null) {
    return `<p class="form-help">Activation preflight is unavailable.</p>`;
  }
  const problems = preflight.problems ?? [];
  const problemsHtml = renderProblemsSection(problems);
  const hasErrorProblems = problems.some((p) => p.severity === "error");
  if (preflight.ok && !hasErrorProblems) {
    const items = PREFLIGHT_PASS_CHECKS.map(
      (check) => `<li data-preflight-check="${escapeHtml(check.id)}">&#10003; ${escapeHtml(check.label)}</li>`,
    ).join("");
    return `<p class="lg-preflight-ok-title">Ready to activate — all preflight checks pass.</p>
<ul class="lg-preflight-pass">${items}</ul>${problemsHtml}`;
  }
  const cards = preflight.blocks.map(renderPreflightBlockCard).join("");
  return `<p class="lg-preflight-blocked-title">Cannot activate this Quote.</p>${cards}${problemsHtml}`;
}

// blocked ⇔ the activation PUT would 409: blocks OR any error-severity
// problem (C2 LIVE); warnings never block.
function preflightStateAttr(preflight: ActivationPreflight | null): string {
  if (preflight === null) return "unknown";
  const hasErrorProblems = (preflight.problems ?? []).some((p) => p.severity === "error");
  return preflight.ok && !hasErrorProblems ? "pass" : "blocked";
}

// The head publish chip (05 §5.2 advisory → authoritative verdict, re-labeled
// per v2.5 14 §14.2 with counts: "Blocked (2 errors)" / "Ready (3 warnings)").
// Same id + data-publish-verdict contract the ES5 re-renderer updates.
function renderPublishBadge(preflight: ActivationPreflight | null): string {
  if (preflight === null) return "";
  const counts = publishChipCounts(preflight);
  const verdict = preflight.ok && counts.errors === 0 ? "ok" : "blocked";
  return `<span id="lg-publish-badge" class="lg-chip lg-publish-chip" data-publish-verdict="${verdict}" data-publish-errors="${counts.errors}" data-publish-warnings="${counts.warnings}">${escapeHtml(publishChipLabel(counts))}</span>`;
}

// Activation panel (§17 per-site + the 05 §5.2 preflight panel).
function renderActivationPanel(activation: ActivationBody | null): string {
  const preflight = activation?.activation_preflight ?? null;
  const sites = activation?.sites ?? [];
  const rows = sites
    .map(
      (s) => `<div class="lg-activation-row" data-site-id="${escapeHtml(s.site_id)}">
  <label class="lg-check"><input type="checkbox" data-site-enabled${s.enabled ? " checked" : ""} /> ${escapeHtml(s.site_name)}</label>
  <input class="form-input" data-site-slug placeholder="slug (blank = root /lg)" value="${escapeHtml(s.slug ?? "")}" />
  <a href="${escapeHtml(s.preview_url)}" class="form-help" data-preview-url target="_blank" rel="noopener">${escapeHtml(s.preview_url)}</a>
  <button type="button" class="btn btn-sm btn-secondary" data-save-activation>Save</button>
  <button type="button" class="btn btn-sm btn-outline" data-deactivate>Deactivate</button>
</div>`,
    )
    .join("");
  return `<div class="lg-qpanel" data-panel="activation">
  <div class="card">
    <h3>Activation preflight (§5.2)</h3>
    <div id="lg-preflight-panel" data-preflight-state="${preflightStateAttr(preflight)}">${renderPreflightPanelBody(preflight)}</div>
  </div>
  <div class="card">
    <h3>Site activation (§17)</h3>
    <p class="form-help">At most one enabled root (blank slug) per site (§17.1). Activating a second root while one is enabled is rejected — disable it or set a slug.</p>
    <div id="lg-activation-list">${rows || `<p class="form-help" data-empty-activation>No sites available.</p>`}</div>
  </div>
</div>`;
}

// Analytics panel (§15.6 read-only) — filled after paint.
function renderAnalyticsPanel(): string {
  return `<div class="lg-qpanel" data-panel="analytics">
  <div class="card">
    <h3>Funnel analytics (§15.6)</h3>
    <div class="table-wrapper">
      <table class="table" id="lg-analytics-table" aria-label="Funnel analytics">
        <thead><tr>
          <th scope="col">Funnel</th><th scope="col" class="lg-num">Visits</th><th scope="col" class="lg-num">Bounce</th>
          <th scope="col" class="lg-num">Completion</th><th scope="col" class="lg-num">CVR (clicks)</th>
          <th scope="col" class="lg-num">CVR (completed)</th><th scope="col" class="lg-num">Avg RPC</th>
          <th scope="col" class="lg-num">Avg RPS</th><th scope="col" class="lg-num">Unfilled</th><th scope="col" class="lg-num">Revenue</th>
        </tr></thead>
        <tbody id="lg-analytics-body"><tr><td colspan="10" class="form-help">Loading…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>`;
}

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
function renderMediaPickerModal(aiImageAvailable: boolean): string {
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

function quoteDataBlob(
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

function quoteEditorHtml(
  structure: StructureBody,
  selected: VariantNode,
  designs: Array<{ id: string; label: string }>,
  auctions: AuctionListItem[],
  available: AvailableSection[],
  activation: ActivationBody | null,
  frame: FrameGetBody | null,
  theme: ThemeGetBody | null,
  templates: FrameTemplateItem[],
  routingData: RoutingBuilderData,
  brand: { userEmail?: string },
  // FIX 8c: whether POST /api/admin/ai/image is usable — false hides the
  // picker's "Generate with AI" affordance (§8.4).
  aiImageAvailable = false,
): string {
  const q = structure.quote;
  const sites = previewSiteOptions(activation);
  const funnelPublicId =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id)?.public_id ??
    structure.funnels[0]?.public_id ??
    "";
  // Rework M1 replacement semantics — see primaryVariantOf's doc comment.
  const ownFunnel = structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? null;
  const selectedIsControl = primaryVariantOf(ownFunnel?.variants ?? [selected])?.public_id === selected.public_id;
  const verticalChips = (Array.isArray(q.verticals_json) ? q.verticals_json : [])
    .map((v) => `<span class="lg-chip">${escapeHtml(v)}</span>`)
    .join("");

  // §4.1 top bar: name · status pill · Activity chip · verticals chips ·
  // funnel/variant selector (+ fork) · publish chip · preview-site selector ·
  // Save · Publish (opens the Activation tab, where the per-site preflight-
  // gated activate lives).
  const head = `<div class="lg-editor-head">
    <a href="/admin/leadgen/quotes" class="btn btn-outline">&#8592; Quotes</a>
    <h2 class="lg-editor-title" id="lg-quote-title">${escapeHtml(q.quote_name)}</h2>
    <button type="button" class="btn btn-sm btn-outline" id="lg-quote-rename" aria-label="Rename this quote" title="Rename">&#9998;</button>
    <span class="lg-rename-editor lg-hidden" id="lg-quote-rename-editor">
      <input class="form-input" id="lg-quote-rename-input" aria-label="Quote name" />
      <button type="button" class="btn btn-sm btn-primary" id="lg-quote-rename-save">Save name</button>
      <button type="button" class="btn btn-sm btn-outline" id="lg-quote-rename-cancel">Cancel</button>
    </span>
    ${statusBadge(q.status)}
    <span class="lg-chip" data-quote-activity>Activity: <strong>${escapeHtml(q.activity)}</strong></span>
    ${verticalChips}
    ${renderPublishBadge(activation?.activation_preflight ?? null)}
    <span class="lg-editor-spacer"></span>
    <span class="lg-chip" id="lg-site-chip">Preview site: ${renderSiteSelect("lg-site-select", sites)}</span>
    <button type="button" id="lg-variant-save" class="btn btn-primary">Save</button>
    <button type="button" id="lg-publish-goto" class="btn btn-secondary" data-goto-tab="activation">Publish&#8230;</button>
  </div>
  <details class="lg-advanced"><summary>Advanced</summary>
    <p class="form-help">Reference id: <code class="lg-editor-pubid">${escapeHtml(q.public_id)}</code></p>
  </details>`;

  // Round-4 P4b (operator restructure spec): the standalone "Rules" top tab
  // is REMOVED — routing rules now live INSIDE the Funnel builder tab's
  // right-hand column (renderInspectorColumn -> renderRulesPanel). Four tabs,
  // not five. Round-4 P5b (operator restructure spec): "Templates" (the
  // seven box pickers) and "Themes" (the moved theme editor) are promoted to
  // TOP tabs beside Funnel builder/A/B/Activation/Analytics — inserted right
  // after Funnel builder. The canvas toolbar's "Theme" quick-access button
  // JUMPS to the Themes tab (deliverable 1's explicit instruction); "Template"
  // keeps its EXISTING inline toggle — the 6-arrangement picker stays
  // canvas-embedded (a REPORTED, deliberate deviation: see
  // renderTemplatePicker's doc comment for the VERIFIED test-ui/leadgen-
  // quote-builder.spec.ts regression this avoids).
  const subtabs = `<nav class="lg-qtabs" aria-label="Quote editor tabs">
  <button type="button" class="lg-qtab active" data-tab="builder">Funnel builder</button>
  <button type="button" class="lg-qtab" data-tab="templates">Templates</button>
  <button type="button" class="lg-qtab" data-tab="themes">Themes</button>
  <button type="button" class="lg-qtab" data-tab="ab">A/B</button>
  <button type="button" class="lg-qtab" data-tab="activation">Activation</button>
  <button type="button" class="lg-qtab" data-tab="analytics">Analytics</button>
</nav>`;

  const variantBar = `<div class="lg-editor-head">
  ${renderVariantSelector(structure, selected)}
  <button type="button" class="btn btn-sm btn-outline" data-fork-variant="${escapeHtml(selected.public_id)}">Fork this variant</button>
</div>`;

  const content = `${renderLeadgenTabs("quotes")}
<div id="lg-quote-editor" data-quote-id="${q.id}" data-quote-public-id="${escapeHtml(q.public_id)}" data-variant-public-id="${escapeHtml(selected.public_id)}" data-variant-funnel-id="${escapeHtml(selected.funnel_id)}" data-variant-funnel-variant-id="${escapeHtml(selected.funnel_variant_id)}" data-funnel-public-id="${escapeHtml(funnelPublicId)}">
  ${head}
  <p id="lg-quote-error" class="alert alert-error" hidden role="alert"></p>
  <p id="lg-quote-ok" class="alert alert-success" hidden role="status"></p>
  ${variantBar}
  ${subtabs}
  ${renderBuilderPanel(structure, selected, designs, auctions, available, templates, sites, routingData)}
  ${renderTemplatesTabPanel(selectedIsControl, routingData.fields)}
  ${renderThemesTabPanel(selectedIsControl)}
  ${renderAbPanel(structure, selected)}
  ${renderActivationPanel(activation)}
  ${renderAnalyticsPanel()}
  ${renderMediaPickerModal(aiImageAvailable)}
  <script type="application/json" id="lg-quote-data">${quoteDataBlob(structure, selected, funnelPublicId, frame, theme, templates, sites, activation)}</script>
</div>`;

  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    content,
    styles: LG_QUOTES_STYLES,
    scripts: QUOTE_EDITOR_SCRIPT + RULES_BUILDER_SCRIPT + ROUTING_RULES_SCRIPT,
  });
}

function quoteNotFoundPage(brand: { userEmail?: string }): string {
  const content = `${renderLeadgenTabs("quotes")}
<div class="card"><div class="empty-state">
  <p>Quote not found.</p>
  <a href="/admin/leadgen/quotes" class="btn btn-primary">Back to Quotes</a>
</div></div>`;
  return leadgenPageShell({
    activePath: "/admin/leadgen/quotes",
    userEmail: brand.userEmail,
    content,
    styles: LG_QUOTES_STYLES,
  });
}

export async function leadgenQuoteEditorPage(c: UiContext): Promise<Response> {
  const idParam = c.req.param("id") ?? "";
  const structureRes = await apiJson<StructureBody>(
    c.env,
    `/api/admin/leadgen/quotes/${encodeURIComponent(idParam)}/structure`,
  );
  if (!structureRes.ok) return c.html(quoteNotFoundPage(branding(c)), 404);
  const structure = structureRes.body;

  const wanted = c.req.query("variant")?.trim() ?? "";
  const selected = findSelectedVariant(structure, wanted);
  if (selected === null) return c.html(quoteNotFoundPage(branding(c)), 404);

  // Round-4 P3b: attach the FULL page/slot tree to the SELECTED variant (the
  // one the structure panel renders). loadVariantPages is the canonical loader
  // — real pages when the variant has any, else its own synthetic
  // one-fixed-slot-per-section wrap (so a pre-page-model or freshly section-
  // saved variant still renders as ordered single-section pages that round-
  // trip byte-identically). See buildPageNodes.
  selected.pages = buildPageNodes(await loadVariantPages(c.env.DB, selected.id));

  const activity = structure.quote.activity;
  const encodedQuote = encodeURIComponent(structure.quote.public_id);
  const sectionsRes = await apiJson<ListBody<AvailableSection>>(
    c.env,
    `/api/admin/leadgen/sections?activity=${encodeURIComponent(activity)}&status=active&page_size=200`,
  );
  const auctionsRes = await apiJson<ListBody<AuctionListItem>>(
    c.env,
    `/api/admin/leadgen/auctions?page_size=200`,
  );
  const activationRes = await apiJson<ActivationBody>(
    c.env,
    `/api/admin/leadgen/quotes/${encodedQuote}/activation`,
  );

  // --- v2.5 §4.1 studio state (same in-process API the browser XHRs hit) ----
  const funnelPublicId =
    structure.funnels.find((f) => f.funnel_id === selected.funnel_id)?.public_id ??
    structure.funnels[0]?.public_id ??
    "";
  const encodedFunnel = encodeURIComponent(funnelPublicId);
  const frameRes = await apiJson<FrameGetBody>(c.env, `/api/admin/leadgen/funnels/${encodedFunnel}/frame`);
  const themeRes = await apiJson<ThemeGetBody>(c.env, `/api/admin/leadgen/funnels/${encodedFunnel}/theme`);
  const templatesRes = await apiJson<{ items: FrameTemplateItem[] }>(c.env, "/api/admin/leadgen/frame-templates");
  const offersRes = await apiJson<ListBody<OfferListItem>>(c.env, "/api/admin/leadgen/offers?page_size=200");

  // B3 rules-builder data: this variant's rules + the internal fields of the
  // activity's Sections (from their content_json components) + Offers.
  const available = sectionsRes.ok ? sectionsRes.body.items : [];
  const fieldSeen = new Set<string>();
  const fields: { internal_field: string; label: string }[] = [];
  for (const section of available) {
    const content = section.content_json;
    const components =
      content !== null && typeof content === "object" && Array.isArray((content as { components?: unknown }).components)
        ? ((content as { components: unknown[] }).components)
        : [];
    for (const node of components) {
      if (node === null || typeof node !== "object") continue;
      const internalField = (node as { internal_field?: unknown }).internal_field;
      if (typeof internalField !== "string" || internalField === "" || fieldSeen.has(internalField)) continue;
      fieldSeen.add(internalField);
      fields.push({ internal_field: internalField, label: `${section.section_name} · ${internalField}` });
    }
  }
  // Round-4 P4b: the SAME funnel's OTHER variants are the route_funnel_variant
  // target scope (P4a resolver.ts anti-leak: same-funnel only — see the
  // dispatch's "SAME quote's variants" phrasing, corrected here against the
  // VERIFIED runtime constraint, which is same-FUNNEL, not same-quote; a
  // quote can have multiple funnels and a cross-funnel target would silently
  // never match at runtime). Self (the CURRENTLY edited variant) is NOT
  // excluded from the picker (the action panel's own label is "Route to a
  // DIFFERENT funnel" — a self-route is a meaningless no-op, so it is never
  // offered as a choice; renderRuleRow's target_funnel_variant_id -> public_id
  // resolution is a best-effort display lookup only, over this SAME list).
  const ownFunnel = structure.funnels.find((f) => f.funnel_id === selected.funnel_id) ?? null;
  const routingVariants: RoutingBuilderVariantRefLocal[] = (ownFunnel?.variants ?? [])
    .filter((v) => v.public_id !== selected.public_id)
    .map((v) => ({ id: v.id, public_id: v.public_id, name: v.variant_label }));

  const routingData: RoutingBuilderData = {
    rules: selected.rules.map((r, i) => toRoutingRuleRowData(r, i)),
    fields,
    offers: (offersRes.ok ? offersRes.body.items : []).map((o) => ({ id: o.id, name: o.offer_name })),
    sections: available.map((s) => ({ id: s.id, name: s.section_name })),
    variants: routingVariants,
    field_pages: buildFieldPageMap(selected.pages ?? [], available),
    page_count: Math.max(1, (selected.pages ?? []).length),
  };

  return c.html(
    quoteEditorHtml(
      structure,
      selected,
      listFunnelDesignOptions(),
      auctionsRes.ok ? auctionsRes.body.items : [],
      available,
      activationRes.ok ? activationRes.body : null,
      frameRes.ok ? frameRes.body : null,
      themeRes.ok ? themeRes.body : null,
      templatesRes.ok ? templatesRes.body.items : [],
      routingData,
      branding(c),
      typeof c.env.OPENAI_API_KEY === "string" && c.env.OPENAI_API_KEY !== "",
    ),
  );
}

// Local alias (ui-rules-builder.ts's RoutingBuilderVariantRef, re-exported by
// name here only to keep the array-literal construction above readable).
type RoutingBuilderVariantRefLocal = RoutingBuilderData["variants"][number];

// Round-4 P4b: RuleNode (the API/client rule shape) -> the unified builder's
// table/modal seed shape. rule_type is widened from `string` defensively
// (any legacy/corrupt value outside the known types falls back to
// "eligibility" for DISPLAY only — the real stored value rides byte-exact in
// the hidden [data-rule-type] carrier collectRules() reads, so a save never
// silently changes an unrecognized type). Rework M3: derived from
// ui-rules-builder.ts's ROUTING_RULE_TYPES (the single source of truth for
// leadgen_funnel_rules' 4-type CHECK) instead of a hand-duplicated list, so
// the two files can never drift apart again the way the pre-rework 7-value
// literal did.
const KNOWN_ROUTING_RULE_TYPES: ReadonlySet<string> = new Set(ROUTING_RULE_TYPES);
function toRoutingRuleRowData(r: RuleNode, index: number): RoutingRuleRowData {
  return {
    index,
    public_id: r.public_id,
    rule_type: (KNOWN_ROUTING_RULE_TYPES.has(r.rule_type) ? r.rule_type : "eligibility") as RoutingRuleType,
    rule_name: r.rule_name ?? null,
    status: r.status === "disabled" ? "disabled" : "active",
    priority: r.priority,
    match_mode: r.match_mode === "any" ? "any" : "all",
    checkpoint_page: r.checkpoint_page ?? null,
    conditions_json: r.conditions_json ?? { groups: [] },
    target_offer_id: r.target_offer_id,
    target_section_id: r.target_section_id,
    target_funnel_variant_id: r.target_funnel_variant_id ?? null,
    value_multiplier: r.value_multiplier ?? null,
    redirect_url: r.redirect_url,
    redirect_url_allowlisted: r.redirect_url_allowlisted,
    redirect_pct: r.redirect_pct ?? null,
  };
}

// Round-4 P4b: mirrors resolver.ts's private fieldToPageIndex / quotes-
// handlers.ts's computeFieldToPageIndex (SAME "later page overwrites -> max"
// rule) using data already loaded for this page render (the variant's
// PageNode[] tree + the activity's Sections' content_json) — the checkpoint-
// display mirror input ROUTING_RULES_SCRIPT reads. A field absent here falls
// back to the LAST page at derive-time, matching the server exactly.
function buildFieldPageMap(pages: readonly PageNode[], available: readonly AvailableSection[]): Record<string, number> {
  const sectionFields = new Map<string, string[]>();
  for (const s of available) {
    const content = s.content_json;
    const components =
      content !== null && typeof content === "object" && Array.isArray((content as { components?: unknown }).components)
        ? ((content as { components: unknown[] }).components)
        : [];
    const names: string[] = [];
    for (const node of components) {
      if (node === null || typeof node !== "object") continue;
      const f = (node as { internal_field?: unknown }).internal_field;
      if (typeof f === "string" && f !== "") names.push(f);
    }
    sectionFields.set(s.public_id, names);
  }
  const out: Record<string, number> = {};
  pages.forEach((page, idx) => {
    for (const slot of page.slots) {
      const refs: SectionRef[] = [];
      if (slot.fixed) refs.push(slot.fixed);
      if (slot.ab) for (const a of slot.ab) refs.push(a);
      if (slot.ruled) {
        for (const c of slot.ruled.cases) refs.push(c);
        refs.push(slot.ruled.default_section);
      }
      for (const ref of refs) {
        const names = sectionFields.get(ref.section_id) ?? [];
        for (const f of names) out[f] = idx; // later page overwrites -> max
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Editor inline script (strict ES5) — tabs, section-order, rules, save,
// preview, activation, A/B lifecycle, unsaved-changes guard.
// ---------------------------------------------------------------------------

const QUOTE_EDITOR_SCRIPT = `
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
  // §4.1 structure-panel links into the A/B tab (and the head Publish button
  // into Activation). Round-4 P4b: "rules" is no longer its OWN top tab (the
  // routing-rules table+modal moved INSIDE the Funnel builder tab's right
  // column — renderInspectorColumn/renderRulesPanel) — a data-goto-tab="rules"
  // link (the structure panel's "Rules for this variant" shortcut) now
  // activates 'builder' and scrolls the embedded panel into view instead.
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
    var auctionSel = byId('lg-auction-id');
    var auctionVal = auctionSel && auctionSel.value ? Number(auctionSel.value) : null;
    var payload = {
      lander_enabled: byId('lg-lander-enabled').checked,
      lander_headline: byId('lg-lander-headline').value,
      lander_subheadline: byId('lg-lander-sub').value,
      lander_hero_media_url: byId('lg-lander-hero').value,
      funnel_design_id: byId('lg-funnel-design').value,
      auction_id: auctionVal,
      rules: collectRules()
    };
    // Round-4 P3b: pages-first replace-set. When the panel rendered page cards
    // (the production path — loadVariantPages ALWAYS yields >=1 page, real or
    // its synthetic per-section wrap) the variant PUT carries pages (mutually
    // exclusive with sections). A page-LESS DOM (a legacy / harness mount
    // with flat rows and no [data-page]) falls back to the byte-equivalent
    // sections replace-set. Sending pages for a real (incl. migrated)
    // variant is REQUIRED: the sections path would leave the migrated
    // leadgen_funnel_pages rows orphaned and the loader renders them empty.
    if (sectionList && sectionList.querySelectorAll('[data-page]').length > 0) {
      payload.pages = collectPages();
    } else {
      payload.sections = collectSections();
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
`;
