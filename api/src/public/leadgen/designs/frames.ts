// LeadGen v2.5 FRAME module (redesign-contract-v2.5 03 §3.3/§3.6, 04 §4.3,
// 13 §13.2). PURE: no DB, no Hono, no admin imports — shared verbatim by
// runtime serve, both preview endpoints, and the Quote Builder's
// `effective_frame` echo (one merge implementation, §13.2).
//
// Owns:
//   - the `frame_config_json` TypeScript contract (§3.3): every group
//     (header / progress / back / disclosure / footer / trust_strip /
//     benefit_bar / background / section_slot / mobile / compat), closed-set
//     enums, role-name colours, media_id media refs, plain-text copy;
//   - FRAME_TEMPLATES — the 6 frame templates (§4.3), each = complete named
//     per-group defaults matching the arrangement table ("registry: code,
//     not DB");
//   - effectiveFrame — template defaults ⊕ funnel frame_config_json ⊕ variant
//     frame_overrides_json (sparse deep-merge, arrays replaced whole, §13.2);
//     unknown template id in STORED json → `centered` + a problems[] warning
//     (mirror of the design-registry unknown-id fallback rule);
//   - validateFrameConfig — server gate for PUT /funnels/:id/frame (§4.8):
//     unknown keys REJECTED, path-precise §3.6 problems in operator language.

import { FUNNEL_TOKEN_ROLES, isFunnelTokenRole } from "./theme";
import type { FunnelTokenRole, Problem, ProblemSeverity, VariantThemeOverrides } from "./theme";

// ---------------------------------------------------------------------------
// §3.3 enums (closed sets).
// ---------------------------------------------------------------------------

export const FRAME_TEMPLATE_IDS = [
  "centered",
  "header-footer",
  "header-cta",
  "full-background",
  "white-trust",
  "minimal",
] as const;

export type FrameTemplateId = (typeof FRAME_TEMPLATE_IDS)[number];

const FRAME_TEMPLATE_ID_SET: ReadonlySet<string> = new Set(FRAME_TEMPLATE_IDS);

export function isFrameTemplateId(value: unknown): value is FrameTemplateId {
  return typeof value === "string" && FRAME_TEMPLATE_ID_SET.has(value);
}

// The registry/default fallback template (mirrors getFunnelDesign's rule).
export const DEFAULT_FRAME_TEMPLATE_ID: FrameTemplateId = "centered";

export const FRAME_LOGO_SOURCES = ["site", "cms_fallback", "manual"] as const;
export const FRAME_SIZES = ["s", "m", "l"] as const;
export const FRAME_LOGO_ALIGNS = ["left", "center"] as const;
// Round-4 P5a (10D / B-4.7): `icon_on_track` is a REAL fifth visible style
// (a theme-icon thumb riding the fill edge) — `numbered` stops being a fake
// alias of `bar` (frame.ts renders distinct numbered-circle markup; styles.ts
// gives every style a distinct rule). ADDITIVE to the enum: pre-P5a stored
// configs never carry `icon_on_track`, so validation/round-trip are unchanged.
export const FRAME_PROGRESS_STYLES = ["hidden", "bar", "dots", "numbered", "percent", "icon_on_track"] as const;
export const FRAME_PROGRESS_POSITIONS = ["top", "under_header", "above_unit", "in_card"] as const;
export const FRAME_PROGRESS_ALIGNS = ["left", "center", "right"] as const;
export const FRAME_PROGRESS_WIDTHS = ["content", "full"] as const;
export const FRAME_BACK_STYLES = ["hidden", "text", "icon_text", "button"] as const;
export const FRAME_BACK_POSITIONS = ["under_header_left", "in_card", "below_card", "footer"] as const;
export const FRAME_DISCLOSURE_LOCATIONS = ["top_bar", "header", "footer", "modal"] as const;
export const FRAME_FOOTER_SHOW_ON = ["all", "first", "final", "never"] as const;
export const FRAME_FOOTER_LINKS_SOURCES = ["site", "manual"] as const;
export const FRAME_TRUST_SOURCES = ["manual", "site_logo_set"] as const;
export const FRAME_TRUST_PLACEMENTS = ["below_unit", "footer", "between_progress_and_unit"] as const;
export const FRAME_TRUST_MOBILE_MODES = ["wrap", "scroll", "hide"] as const;
export const FRAME_BENEFIT_PLACEMENTS = ["bottom", "below_unit"] as const;
export const FRAME_BACKGROUND_STYLES = ["flat", "brand", "brand_gradient"] as const;
export const FRAME_SLOT_CARDS = ["card", "bare"] as const;
export const FRAME_SLOT_OFFSETS = ["none", "s", "m"] as const;
export const FRAME_SLOT_TRANSITIONS = ["fade", "none"] as const;
export const FRAME_CONTINUE_PLACEMENTS = ["inside_unit", "below_unit"] as const;
// Fixed single-value sets in v2.5 (§3.3 `align:"center"` "(fixed v2.5)" and
// `continue_style_role:"button_primary"`) — widened by a later contract, not
// by this module.
export const FRAME_SLOT_ALIGNS = ["center"] as const;
export const FRAME_CONTINUE_STYLE_ROLES = ["button_primary"] as const;

// ---------------------------------------------------------------------------
// Round-4 P5a — AUTHORABLE FRAME ELEMENTS v2 (investigation B-2 items
// 10C/10E/10F/10G/10H + 10H-adjacent). ALL server-rendered (frame.ts), ZERO
// runtime-engine bytes (these modules are not in the client bundle — verified).
// Every new group is OPTIONAL on the effective config and ABSENT from
// baseFrameDefaults(), so a pre-P5a stored config produces a byte-identical
// effective frame and a byte-identical render (back-compat by construction).
// ---------------------------------------------------------------------------

// Shared visual vocabulary for the new elements (theme-token driven).
export const FRAME_ELEMENT_ALIGNS = ["left", "center", "right"] as const;
export const FRAME_TYPO_SIZES = ["s", "m", "l", "xl"] as const;

// Per-element page targeting (10E/10F/10G). `all` and `first` ride the EXISTING
// engine `[data-show-on]` toggle (render.ts updateFooterVisibility selects EVERY
// [data-show-on] on the root — zero new bytes, live-correct). `range`/`list`
// bake the page-1 verdict server-side + stamp `data-frame-pages`; live toggling
// for arbitrary pages is a DOCUMENTED engine seam (a generalized page compare in
// updateFooterVisibility — runtime/*, not P5a-owned).
export const FRAME_PAGE_TARGET_MODES = ["all", "first", "range", "list"] as const;

// 10E free-text slots (relative to the swapped section unit + the header/footer).
export const FRAME_FREE_TEXT_SLOTS = ["above_section", "below_section", "above_header", "below_footer"] as const;

// 10E free-text inline block model (mirrors api/src/editor/blocks.ts inline
// model: paragraph/heading + a ✓/ordered/unordered list; bold/italic/link ride
// `html` through the SAME sanitizeHtml, plain copy rides `text` through escape).
export const FRAME_FREE_TEXT_BLOCK_TYPES = ["paragraph", "heading", "list"] as const;
export const FRAME_FREE_TEXT_LIST_STYLES = ["unordered", "ordered", "check"] as const;

// 10F brand-logos strip layout (desktop row / mobile grid presets in styles.ts).
export const FRAME_BRAND_LOGO_LAYOUTS = ["row", "grid"] as const;

// 10C CTA/phone slots (the four placeable slots + per-slot alignment).
export const FRAME_CTA_SLOTS = ["header_right", "under_header", "section_bottom", "footer"] as const;

// 10H-adjacent disclosure v2 — per-location entries, full|hover mode.
export const FRAME_DISCLOSURE_V2_LOCATIONS = ["top", "bottom"] as const;
export const FRAME_DISCLOSURE_MODES = ["full", "hover"] as const;

// 10H footer v2 block model.
export const FRAME_FOOTER_BLOCK_TYPES = [
  "about_paragraph",
  "link_row",
  "disclosure",
  "logo",
  "address",
  "socials",
] as const;

// ---------------------------------------------------------------------------
// §3.3 group shapes — the COMPLETE (effective) config. The STORED column is
// the sparse `FrameConfig` below; effectiveFrame always yields this full
// shape. All colours are ROLE NAMES (09); media refs are media_id strings;
// copy fields are plain text (escaped at render).
// ---------------------------------------------------------------------------

export interface FrameSecureBadgeConfig {
  enabled: boolean;
  text: string | null;
}

export interface FrameHeaderCtaConfig {
  enabled: boolean;
  label: string;
  href: string | null;
  tel: string | null;
}

export interface FrameHeaderConfig {
  enabled: boolean;
  logo_source: (typeof FRAME_LOGO_SOURCES)[number];
  logo_media_id: string | null; // manual only
  logo_size: (typeof FRAME_SIZES)[number];
  logo_align: (typeof FRAME_LOGO_ALIGNS)[number];
  tagline: string | null;
  secure_badge: FrameSecureBadgeConfig;
  cta: FrameHeaderCtaConfig;
  disclosure_link: boolean;
  sticky: boolean;
}

export interface FrameProgressConfig {
  style: (typeof FRAME_PROGRESS_STYLES)[number];
  position: (typeof FRAME_PROGRESS_POSITIONS)[number];
  thickness: (typeof FRAME_SIZES)[number];
  width: (typeof FRAME_PROGRESS_WIDTHS)[number];
  color_role: FunnelTokenRole;
  show_label: boolean;
  // Round-4 P5a (10D): optional alignment of the progress unit within its width
  // band. OPTIONAL + absent from defaults → pre-P5a configs stay byte-identical
  // (frame.ts falls back to "center").
  align?: (typeof FRAME_PROGRESS_ALIGNS)[number];
}

// Behaviour is fixed (§3.3): previous Section per Variant order, hidden on the
// first Section — the engine already does this; only presentation is config.
export interface FrameBackConfig {
  style: (typeof FRAME_BACK_STYLES)[number];
  position: (typeof FRAME_BACK_POSITIONS)[number];
  label: string;
  history_fallback: boolean;
}

// Round-4 P5a (10H-adjacent) disclosure v2 — a per-LOCATION entry. `full` mode
// prints the copy inline; `hover` mode prints a focusable trigger with a
// CSS-only tooltip (title + [tabindex] span — no JS, a11y note in frame.ts).
// top + bottom entries coexist.
export interface FrameDisclosureEntry {
  location: (typeof FRAME_DISCLOSURE_V2_LOCATIONS)[number];
  text: string;
  mode: (typeof FRAME_DISCLOSURE_MODES)[number];
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  link_label?: string; // hover-mode trigger copy (defaults to link_label / "Disclosure")
}

export interface FrameDisclosureConfig {
  enabled: boolean;
  location: (typeof FRAME_DISCLOSURE_LOCATIONS)[number];
  link_label: string;
  text: string; // panel copy, plain text
  // Round-4 P5a disclosure v2: when present, these per-location entries render
  // (top+bottom simultaneous, per-entry mode/align). ABSENT → the legacy single
  // {location,link_label,text} behavior is byte-identical. OPTIONAL + absent
  // from defaults, so pre-P5a configs are unchanged.
  entries?: FrameDisclosureEntry[];
}

export interface FrameFooterLink {
  label: string;
  href: string;
}

// Round-4 P5a (10H) footer v2 — a block. One `type` per row; only that type's
// fields are read (extra fields are ignored at render, rejected at validate).
export interface FrameFooterSocialLink {
  platform: string; // label/icon key (escaped)
  url: string; // SAFE_HREF gated
}
export interface FrameFooterBlock {
  type: (typeof FRAME_FOOTER_BLOCK_TYPES)[number];
  text?: string; // about_paragraph / disclosure / address copy
  links_source?: (typeof FRAME_FOOTER_LINKS_SOURCES)[number]; // link_row
  links?: FrameFooterLink[]; // link_row (manual)
  socials?: FrameFooterSocialLink[]; // socials
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
}

// Footer's OWN palette/typography scope (10H "different color, font and sizes
// than the main template") — role names + a size token; rendered as CSS custom
// properties scoped to the footer element only.
export interface FramePaletteScope {
  background?: FunnelTokenRole;
  text?: FunnelTokenRole;
  link?: FunnelTokenRole;
}
export interface FrameTypographyScope {
  size?: (typeof FRAME_TYPO_SIZES)[number];
}

export interface FrameFooterConfig {
  enabled: boolean;
  show_on: (typeof FRAME_FOOTER_SHOW_ON)[number];
  links_source: (typeof FRAME_FOOTER_LINKS_SOURCES)[number];
  links: FrameFooterLink[]; // manual mode
  trust_text: string | null;
  description: string | null;
  show_logo: boolean;
  hide_on_mobile: boolean;
  // Round-4 P5a footer v2: when `blocks` is present the block model renders (own
  // palette/typography scope); ABSENT → the legacy FooterBar composition is
  // byte-identical. OPTIONAL + absent from defaults, so pre-P5a configs render
  // unchanged.
  blocks?: FrameFooterBlock[];
  palette_scope?: FramePaletteScope;
  typography_scope?: FrameTypographyScope;
}

export interface FrameTrustLogo {
  media_id: string;
  alt: string; // REQUIRED (§3.3)
}

export interface FrameTrustStripConfig {
  enabled: boolean;
  source: (typeof FRAME_TRUST_SOURCES)[number];
  logos: FrameTrustLogo[];
  placement: (typeof FRAME_TRUST_PLACEMENTS)[number];
  mobile: (typeof FRAME_TRUST_MOBILE_MODES)[number];
}

export interface FrameBenefitItem {
  icon: string;
  text: string;
}

export interface FrameBenefitBarConfig {
  enabled: boolean;
  items: FrameBenefitItem[];
  placement: (typeof FRAME_BENEFIT_PLACEMENTS)[number];
}

export interface FrameBackgroundConfig {
  role: FunnelTokenRole;
  image_media_id: string | null;
  style: (typeof FRAME_BACKGROUND_STYLES)[number]; // brand/gradient resolve via roles — no raw CSS
}

export interface FrameSectionSlotConfig {
  max_width: (typeof FRAME_SIZES)[number];
  align: (typeof FRAME_SLOT_ALIGNS)[number];
  card: (typeof FRAME_SLOT_CARDS)[number];
  padding: (typeof FRAME_SIZES)[number];
  offset_y: (typeof FRAME_SLOT_OFFSETS)[number];
  allow_section_card: boolean; // false = WARNING surfaced, never silent deletion
  transition: (typeof FRAME_SLOT_TRANSITIONS)[number];
  continue_placement: (typeof FRAME_CONTINUE_PLACEMENTS)[number];
  continue_style_role: (typeof FRAME_CONTINUE_STYLE_ROLES)[number];
}

// §3.3 mobile: sparse overrides — ONLY these keys; everything else inherits
// (breakpoints come from the base design). Sparse even in the effective shape.
export interface FrameMobileConfig {
  hide_footer?: boolean;
  progress_position?: (typeof FRAME_PROGRESS_POSITIONS)[number];
  logo_size?: (typeof FRAME_SIZES)[number];
  trust_strip_mobile?: (typeof FRAME_TRUST_MOBILE_MODES)[number];
}

// §3.3 compat (Advanced-only, C2): the per-Funnel legacy override.
export interface FrameCompatConfig {
  allow_section_chrome: boolean;
}

// ---------------------------------------------------------------------------
// Round-4 P5a — new authorable element shapes (10C/10E/10F/10G).
// ---------------------------------------------------------------------------

// Page targeting (10E/10F/10G). `range` uses from/to (inclusive, 1-based);
// `list` uses pages[]. See FRAME_PAGE_TARGET_MODES for the live/seam split.
export interface FramePageTarget {
  mode: (typeof FRAME_PAGE_TARGET_MODES)[number];
  from?: number;
  to?: number;
  pages?: number[];
}

// Typography override (10E) — theme-token driven (size token + colour ROLE +
// alignment). Every field OPTIONAL; absent = the theme default.
export interface FrameTypographyOverride {
  size?: (typeof FRAME_TYPO_SIZES)[number];
  color?: FunnelTokenRole;
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
}

// 10E free-text block (inline model). `html` = author rich text (bold/italic/
// link) sanitized at render via sanitizeHtml; `text` = plain copy escaped;
// `items` = list rows (each inline-sanitized). `level` (heading) clamped 1..6.
export interface FrameFreeTextBlock {
  type: (typeof FRAME_FREE_TEXT_BLOCK_TYPES)[number];
  html?: string;
  text?: string;
  items?: string[];
  level?: number;
  style?: (typeof FRAME_FREE_TEXT_LIST_STYLES)[number];
}

// 10E free-text element — N blocks at a slot, with alignment/typography and
// page targeting.
export interface FrameFreeTextEntry {
  id: string;
  slot: (typeof FRAME_FREE_TEXT_SLOTS)[number];
  blocks: FrameFreeTextBlock[];
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  typography?: FrameTypographyOverride;
  pages?: FramePageTarget;
}

// 10F brand-logos strip — one authorable strip (media OR url refs; SVG upload
// pipeline lands in P5c — this renderer accepts refs only), row/grid layout,
// per-logo size, placement slot, page targeting.
export interface FrameBrandLogoItem {
  media_id?: string | null;
  url?: string | null;
  alt: string;
  size?: (typeof FRAME_SIZES)[number];
}
export interface FrameBrandLogosConfig {
  enabled: boolean;
  items: FrameBrandLogoItem[];
  layout: (typeof FRAME_BRAND_LOGO_LAYOUTS)[number];
  slot?: (typeof FRAME_FREE_TEXT_SLOTS)[number];
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  pages?: FramePageTarget;
}

// 10C CTA/phone slot. `tel` (number) OR `href` (link). `condition` = a compiled
// P2a condition group over answers + __ctx synthetic keys — a conditional slot
// server-renders HIDDEN and is toggled by the existing evaluator (see frame.ts
// renderCtaSlot for the exact hook + the engine seam it depends on).
export interface FrameCtaCondition {
  match?: "all" | "any";
  when?: string;
  op?: string;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
  conditions?: FrameCtaCondition[];
}
export interface FrameCtaSlotConfig {
  id?: string;
  slot: (typeof FRAME_CTA_SLOTS)[number];
  label: string;
  href?: string | null;
  tel?: string | null;
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  condition?: FrameCtaCondition | null;
}

// 10G trust/benefit rows — authorable Tabler-icon + text rows with an optional
// CSS-only hover tooltip; page targeting.
export interface FrameTrustRowItem {
  icon: string; // a LEADGEN_ICONS key
  text: string;
  tooltip?: string | null;
}
export interface FrameTrustRowConfig {
  items: FrameTrustRowItem[];
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  slot?: (typeof FRAME_FREE_TEXT_SLOTS)[number];
  pages?: FramePageTarget;
}

// Round-4 P5a follow-on (10G / Image24) — a first-class PLACED IMAGE element.
// P5c's AI persona-image generator (generatePersonaImage -> R2) had no
// dedicated place to land; it was riding a brand_logos item, which is
// semantically wrong (a logo STRIP renders N logos in a row/grid; a persona
// portrait is ONE placed visual, optionally with a mouse-over caption — the
// Image24 "secured" tooltip). `images` is the GENERAL name (a persona image is
// just an image with a generated ref + an optional hover caption) so any
// authored/generated image can use it, not only AI personas. media_id/url is
// the SAME dual-shape as FrameBrandLogoItem/FrameTrustLogo: `media_id` is a
// STORAGE KEY string (resolved via mediaUrl(), which also passes an
// already-rooted `/media/...` url or an absolute url through unchanged) — NOT
// the numeric media-table row id some upload endpoints separately return (see
// frame.ts renderImageElement + the P5b picker-hook note in the dispatch
// report). Independently slotted per item (mirrors free_text, not the
// single-slot brand_logos/trust_rows shape) since an author may place several
// images across different regions.
export interface FrameImageItem {
  id: string;
  media_id?: string | null;
  url?: string | null;
  alt: string;
  slot: (typeof FRAME_FREE_TEXT_SLOTS)[number];
  size?: (typeof FRAME_SIZES)[number];
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  tooltip?: string | null; // CSS-only hover caption — the disclosure v2 / trust-row pattern
  pages?: FramePageTarget;
}

// The COMPLETE effective frame configuration (what effectiveFrame returns and
// what renderQuoteFrame consumes).
export interface EffectiveFrameConfig {
  version: 1;
  template: FrameTemplateId;
  compat: FrameCompatConfig;
  header: FrameHeaderConfig;
  progress: FrameProgressConfig;
  back: FrameBackConfig;
  disclosure: FrameDisclosureConfig;
  footer: FrameFooterConfig;
  trust_strip: FrameTrustStripConfig;
  benefit_bar: FrameBenefitBarConfig;
  background: FrameBackgroundConfig;
  section_slot: FrameSectionSlotConfig;
  mobile: FrameMobileConfig;
  // Round-4 P5a authorable elements — OPTIONAL, ABSENT from baseFrameDefaults()
  // (so template defaults + effectiveFrame output stay byte-identical for
  // pre-P5a configs). frame.ts reads each defensively (`?? []`).
  free_text?: FrameFreeTextEntry[];
  brand_logos?: FrameBrandLogosConfig;
  cta_slots?: FrameCtaSlotConfig[];
  trust_rows?: FrameTrustRowConfig[];
  // Round-4 P5a follow-on (10G / Image24): first-class placed images.
  images?: FrameImageItem[];
}

// The STORED shape (`leadgen_funnels.frame_config_json`): every group optional
// → template defaults apply (§3.3); within a group every field optional (a
// sparse patch). Arrays are NEVER partial — a present array replaces the
// default/parent array whole (§13.2).
type SparsePatch<T> = {
  [K in keyof T]?: T[K] extends ReadonlyArray<unknown>
    ? T[K]
    : T[K] extends object
      ? SparsePatch<T[K]>
      : T[K];
};

export type FrameConfig = SparsePatch<EffectiveFrameConfig>;

// RAW stored json as read back from `leadgen_funnels.frame_config_json`: the
// same sparse shape, but `template` is an arbitrary string — a stored id may
// stop existing over time, which is exactly the §4.3 fallback case
// effectiveFrame handles (unknown id → `centered` + warning). A validated
// FrameConfig is assignable to it.
export type StoredFrameConfig = Omit<FrameConfig, "template"> & { template?: string };

// A Variant's `frame_overrides_json` (§3.1): a sparse deep-merge patch of
// frame_config_json PLUS `theme.palette.*` role overrides (§4.5). The `theme`
// key is EXCLUDED from the frame merge — resolveTokens consumes it as its
// layer 3. `template`/`version` are funnel-level and never variant-overridable.
export type FrameOverrides = StoredFrameConfig & { theme?: VariantThemeOverrides };

// ---------------------------------------------------------------------------
// §4.3 FRAME_TEMPLATES — 6 templates, each = named per-group defaults.
// Base defaults are the §3.3 `=` schema defaults; each template patches them
// per its arrangement row. `enabled` flags that require operator CONTENT
// (trust logos, benefit items, call-CTA label/number, manual links) default
// OFF everywhere — a template defines WHERE a region goes when it is on.
// ---------------------------------------------------------------------------

export interface FrameTemplateDef {
  id: FrameTemplateId;
  label: string;
  // §4.3 arrangement row (desktop), verbatim — the picker/thumbnail copy.
  arrangement: string;
  defaults: EffectiveFrameConfig;
}

// The §3.3 field defaults (every `=` in the schema tables), template-agnostic.
function baseFrameDefaults(): EffectiveFrameConfig {
  return {
    version: 1,
    template: DEFAULT_FRAME_TEMPLATE_ID,
    compat: { allow_section_chrome: false },
    header: {
      enabled: true,
      logo_source: "site",
      logo_media_id: null,
      logo_size: "m",
      logo_align: "center",
      tagline: null,
      secure_badge: { enabled: false, text: null },
      cta: { enabled: false, label: "", href: null, tel: null },
      disclosure_link: false,
      sticky: true,
    },
    progress: {
      style: "bar",
      position: "under_header",
      thickness: "m",
      width: "content",
      color_role: "brand_primary",
      show_label: false,
    },
    back: { style: "text", position: "in_card", label: "Back", history_fallback: true },
    disclosure: {
      enabled: false,
      location: "footer",
      link_label: "Advertising Disclosure",
      text: "",
    },
    footer: {
      enabled: true,
      show_on: "all",
      links_source: "site",
      links: [],
      trust_text: null,
      description: null,
      show_logo: false,
      hide_on_mobile: false,
    },
    trust_strip: { enabled: false, source: "manual", logos: [], placement: "below_unit", mobile: "wrap" },
    benefit_bar: { enabled: false, items: [], placement: "below_unit" },
    background: { role: "page_background", image_media_id: null, style: "flat" },
    section_slot: {
      max_width: "m",
      align: "center",
      card: "card",
      padding: "m",
      offset_y: "none",
      allow_section_card: true,
      transition: "fade",
      continue_placement: "inside_unit",
      continue_style_role: "button_primary",
    },
    mobile: {},
  };
}

function makeTemplate(
  id: FrameTemplateId,
  label: string,
  arrangement: string,
  patch: FrameConfig,
): FrameTemplateDef {
  const defaults = baseFrameDefaults();
  mergeInto(defaults as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  defaults.template = id;
  return { id, label, arrangement, defaults };
}

export const FRAME_TEMPLATES: Record<FrameTemplateId, FrameTemplateDef> = {
  // Pattern A (reference-style): the §3.3 schema defaults verbatim.
  centered: makeTemplate(
    "centered",
    "Centered card",
    "logo top-center → progress → centered card slot → trust strip → legal footer",
    {},
  ),
  // Pattern B: classic site chrome — left logo + tagline + secure badge,
  // bare slot, large site footer (site links + logo).
  "header-footer": makeTemplate(
    "header-footer",
    "Site header + footer",
    "site header (logo+tagline+secure) → progress → bare slot → LARGE site footer",
    {
      header: { logo_align: "left", secure_badge: { enabled: true } },
      section_slot: { card: "bare" },
      footer: { show_logo: true },
    },
  ),
  // Pattern C: compliance-forward — disclosure top bar, centered logo with a
  // call-CTA slot (CTA itself stays off until the operator supplies label +
  // number), benefit bar under the unit, back link at the end.
  "header-cta": makeTemplate(
    "header-cta",
    "Header + call CTA",
    "disclosure top bar → logo center + call CTA → progress → slot → benefit bar → back link",
    {
      disclosure: { enabled: true, location: "top_bar" },
      back: { position: "below_card" },
      benefit_bar: { placement: "below_unit" },
    },
  ),
  // Pattern D: brand background, floating logo, step dots above a white card.
  "full-background": makeTemplate(
    "full-background",
    "Full background",
    "brand background → logo → step dots → white card slot → legal footer",
    {
      header: { sticky: false },
      progress: { style: "dots", position: "above_unit" },
      background: { role: "brand_primary", style: "brand" },
      section_slot: { card: "card" },
    },
  ),
  // Pattern A/B hybrid: white page (card_background role), minimal header,
  // bare slot, trust strip pinned to the footer area.
  "white-trust": makeTemplate(
    "white-trust",
    "White + trust bar",
    "white page → minimal header → slot → bottom trust bar",
    {
      header: { logo_size: "s", sticky: false },
      background: { role: "card_background" },
      section_slot: { card: "bare" },
      trust_strip: { placement: "footer" },
    },
  ),
  // Pattern E: clean header, back under the header, bare slot, no footer.
  minimal: makeTemplate(
    "minimal",
    "Minimal",
    "clean header → progress → back → bare slot, no footer",
    {
      back: { position: "under_header_left" },
      section_slot: { card: "bare" },
      footer: { enabled: false },
    },
  ),
};

// ---------------------------------------------------------------------------
// §13.2 effectiveFrame — ONE merge implementation for serve, previews, and
// the Quote Builder echo: template defaults deep-merged with funnel config,
// then variant overrides. Sparse deep-merge; arrays replaced whole; scalars
// and nulls replace; absent keys inherit.
// ---------------------------------------------------------------------------

export interface EffectiveFrameResult {
  frame: EffectiveFrameConfig;
  problems: Problem[];
}

// First argument: a template id (e.g. §13.4 `draft_frame_config` template
// preview-before-apply, where the id wins over the stored one) OR the stored
// funnel config itself (its `.template` selects the template). The funnel
// layer is the explicit second argument when given, else the object passed
// first. Unknown template id in STORED json → `centered` + a problems[]
// warning (mirror of the design-registry unknown-id fallback); ABSENT
// template → `centered` silently (it is simply the default).
export function effectiveFrame(
  template: FrameTemplateId | string | StoredFrameConfig | null | undefined,
  frame_config_json?: StoredFrameConfig | null,
  frame_overrides_json?: FrameOverrides | null,
): EffectiveFrameResult {
  const problems: Problem[] = [];

  const funnel: StoredFrameConfig | null =
    frame_config_json ?? (typeof template === "object" && template !== null ? template : null);

  let requested: string | undefined;
  if (typeof template === "string") {
    requested = template;
  } else if (template !== null && typeof template === "object" && typeof template.template === "string") {
    requested = template.template;
  }
  if (requested === undefined && funnel !== null && typeof funnel.template === "string") {
    requested = funnel.template;
  }

  let templateId: FrameTemplateId;
  if (requested === undefined) {
    templateId = DEFAULT_FRAME_TEMPLATE_ID;
  } else if (isFrameTemplateId(requested)) {
    templateId = requested;
  } else {
    templateId = DEFAULT_FRAME_TEMPLATE_ID;
    problems.push({
      path: "frame.template",
      scope: "frame",
      severity: "warning",
      message: `The '${requested}' frame template isn't available any more — showing the '${DEFAULT_FRAME_TEMPLATE_ID}' layout instead.`,
    });
  }

  const frame = cloneJson(FRAME_TEMPLATES[templateId].defaults);
  if (funnel !== null) {
    const { template: _template, version: _version, ...groups } = funnel;
    mergeInto(frame as unknown as Record<string, unknown>, groups as Record<string, unknown>);
  }
  if (frame_overrides_json !== null && frame_overrides_json !== undefined) {
    // `theme` belongs to resolveTokens layer 3; template/version are
    // funnel-level — none of them merge into the frame (§4.5).
    const { theme: _theme, template: _template, version: _version, ...groups } = frame_overrides_json;
    mergeInto(frame as unknown as Record<string, unknown>, groups as Record<string, unknown>);
  }
  frame.template = templateId;
  frame.version = 1;
  return { frame, problems };
}

// Sparse deep-merge (§13.2): objects merge recursively; arrays replace WHOLE;
// scalars and nulls replace; `undefined` keys inherit. The patch is never
// mutated and never shares references with the result (values are cloned in).
function mergeInto(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      base[key] = cloneJson(value); // arrays replaced whole
      continue;
    }
    if (isRecord(value)) {
      const current = base[key];
      if (isRecord(current)) {
        mergeInto(current, value);
      } else {
        base[key] = cloneJson(value);
      }
      continue;
    }
    base[key] = value;
  }
}

// ---------------------------------------------------------------------------
// validateFrameConfig — §3.3 server validation. Closed-set enums; unknown keys
// REJECTED (top level, group level, nested objects, list entries); colours are
// role names; media refs are media_id strings; href/tel follow the SAFE_HREF
// rule. Problems are §3.6-shaped: path-precise (frame.header.cta.href), scope
// `frame`, operator-language messages (never raw JSON, never internal ids).
// `config` is non-null iff no error-severity problem (warnings keep it).
// ---------------------------------------------------------------------------

export interface FrameConfigValidation {
  config: FrameConfig | null;
  problems: Problem[];
}

// A safe, non-executable link target for the header call-CTA and manual
// footer links: absolute http(s), site-relative path (NOT protocol-relative
// //), fragment, tel: or mailto:. Anything else (javascript:, data:, //host)
// is rejected. MUST stay byte-identical to SAFE_HREF_RE in
// components/content-schema.ts — the canonical source (module-private there,
// so re-declared per the reuse rule).
const SAFE_HREF_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

// A phone target: optional tel: prefix, then + and common phone punctuation.
const SAFE_TEL_RE = /^(tel:)?\+?[0-9(). -]{3,}$/i;

type FrameScalarFieldSpec =
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "text" } // plain text; may be empty (escaped at render)
  | { kind: "text_or_null" }
  | { kind: "required_text" } // non-empty plain text (list-entry fields)
  | { kind: "media_id" } // non-empty media_id string
  | { kind: "media_id_or_null" }
  | { kind: "role" }
  | { kind: "href" }
  | { kind: "href_or_null" }
  | { kind: "tel_or_null" };

// Round-4 P5a: a `custom` kind delegates to a dedicated validator for the
// deeply-nested / optional-field element shapes (disclosure entries, footer
// blocks) the flat scalar-array machinery cannot express. The existing kinds
// are byte-untouched, so every pre-P5a group validates identically.
type FramePush = (severity: ProblemSeverity, path: string, message: string) => void;
type FrameFieldSpec =
  | FrameScalarFieldSpec
  | { kind: "object"; label: string; fields: Record<string, FrameScalarFieldSpec> }
  | { kind: "array"; itemLabel: string; fields: Record<string, FrameScalarFieldSpec> }
  | { kind: "custom"; validate: (value: unknown, path: string, label: string, push: FramePush) => void };

interface FrameGroupSpec {
  label: string;
  fields: Record<string, FrameFieldSpec>;
}

const bool: FrameScalarFieldSpec = { kind: "boolean" };
const text: FrameScalarFieldSpec = { kind: "text" };
const textOrNull: FrameScalarFieldSpec = { kind: "text_or_null" };
const role: FrameScalarFieldSpec = { kind: "role" };
const oneOf = (values: readonly string[]): FrameScalarFieldSpec => ({ kind: "enum", values });

const FRAME_GROUP_SPECS: Record<string, FrameGroupSpec> = {
  header: {
    label: "header",
    fields: {
      enabled: bool,
      logo_source: oneOf(FRAME_LOGO_SOURCES),
      logo_media_id: { kind: "media_id_or_null" },
      logo_size: oneOf(FRAME_SIZES),
      logo_align: oneOf(FRAME_LOGO_ALIGNS),
      tagline: textOrNull,
      secure_badge: {
        kind: "object",
        label: "header secure badge",
        fields: { enabled: bool, text: textOrNull },
      },
      cta: {
        kind: "object",
        label: "header call-to-action",
        fields: { enabled: bool, label: text, href: { kind: "href_or_null" }, tel: { kind: "tel_or_null" } },
      },
      disclosure_link: bool,
      sticky: bool,
    },
  },
  progress: {
    label: "progress",
    fields: {
      style: oneOf(FRAME_PROGRESS_STYLES),
      position: oneOf(FRAME_PROGRESS_POSITIONS),
      thickness: oneOf(FRAME_SIZES),
      width: oneOf(FRAME_PROGRESS_WIDTHS),
      color_role: role,
      show_label: bool,
      align: oneOf(FRAME_PROGRESS_ALIGNS), // Round-4 P5a (10D)
    },
  },
  back: {
    label: "back link",
    fields: {
      style: oneOf(FRAME_BACK_STYLES),
      position: oneOf(FRAME_BACK_POSITIONS),
      label: text,
      history_fallback: bool,
    },
  },
  disclosure: {
    label: "disclosure",
    fields: {
      enabled: bool,
      location: oneOf(FRAME_DISCLOSURE_LOCATIONS),
      link_label: text,
      text: text,
      entries: { kind: "custom", validate: validateDisclosureEntries }, // Round-4 P5a
    },
  },
  footer: {
    label: "footer",
    fields: {
      enabled: bool,
      show_on: oneOf(FRAME_FOOTER_SHOW_ON),
      links_source: oneOf(FRAME_FOOTER_LINKS_SOURCES),
      links: {
        kind: "array",
        itemLabel: "footer link",
        fields: { label: { kind: "required_text" }, href: { kind: "href" } },
      },
      trust_text: textOrNull,
      description: textOrNull,
      show_logo: bool,
      hide_on_mobile: bool,
      // Round-4 P5a footer v2 (10H).
      blocks: { kind: "custom", validate: validateFooterBlocks },
      palette_scope: {
        kind: "object",
        label: "footer palette scope",
        fields: { background: role, text: role, link: role },
      },
      typography_scope: {
        kind: "object",
        label: "footer typography scope",
        fields: { size: oneOf(FRAME_TYPO_SIZES) },
      },
    },
  },
  trust_strip: {
    label: "trust strip",
    fields: {
      enabled: bool,
      source: oneOf(FRAME_TRUST_SOURCES),
      logos: {
        kind: "array",
        itemLabel: "trust logo",
        fields: { media_id: { kind: "media_id" }, alt: { kind: "required_text" } },
      },
      placement: oneOf(FRAME_TRUST_PLACEMENTS),
      mobile: oneOf(FRAME_TRUST_MOBILE_MODES),
    },
  },
  benefit_bar: {
    label: "benefit bar",
    fields: {
      enabled: bool,
      items: {
        kind: "array",
        itemLabel: "benefit item",
        fields: { icon: { kind: "required_text" }, text: { kind: "required_text" } },
      },
      placement: oneOf(FRAME_BENEFIT_PLACEMENTS),
    },
  },
  background: {
    label: "background",
    fields: {
      role: role,
      image_media_id: { kind: "media_id_or_null" },
      style: oneOf(FRAME_BACKGROUND_STYLES),
    },
  },
  section_slot: {
    label: "section slot",
    fields: {
      max_width: oneOf(FRAME_SIZES),
      align: oneOf(FRAME_SLOT_ALIGNS),
      card: oneOf(FRAME_SLOT_CARDS),
      padding: oneOf(FRAME_SIZES),
      offset_y: oneOf(FRAME_SLOT_OFFSETS),
      allow_section_card: bool,
      transition: oneOf(FRAME_SLOT_TRANSITIONS),
      continue_placement: oneOf(FRAME_CONTINUE_PLACEMENTS),
      continue_style_role: oneOf(FRAME_CONTINUE_STYLE_ROLES),
    },
  },
  mobile: {
    label: "mobile",
    fields: {
      hide_footer: bool,
      progress_position: oneOf(FRAME_PROGRESS_POSITIONS),
      logo_size: oneOf(FRAME_SIZES),
      trust_strip_mobile: oneOf(FRAME_TRUST_MOBILE_MODES),
    },
  },
  compat: {
    label: "compatibility",
    fields: {
      allow_section_chrome: bool,
    },
  },
};

// ---------------------------------------------------------------------------
// Round-4 P5a — dedicated validators for the new authorable elements. Every
// message is operator-language (§3.6). Enum checks reuse the closed sets above.
// ---------------------------------------------------------------------------

function inEnum(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

// Shared page-target validator (10E/10F/10G).
function validateFramePageTarget(value: unknown, path: string, push: FramePush): void {
  if (!isRecord(value)) {
    push("error", path, "Page targeting must be a group of settings.");
    return;
  }
  if (!inEnum(value["mode"], FRAME_PAGE_TARGET_MODES)) {
    push("error", `${path}.mode`, `Page targeting must be one of: ${FRAME_PAGE_TARGET_MODES.join(", ")}.`);
  }
  if (value["mode"] === "range") {
    if (typeof value["from"] !== "number" || typeof value["to"] !== "number") {
      push("error", path, "A page range needs a numeric first and last page.");
    }
  }
  if (value["mode"] === "list") {
    const pages = value["pages"];
    if (!Array.isArray(pages) || pages.some((p) => typeof p !== "number")) {
      push("error", `${path}.pages`, "A page list must be a list of page numbers.");
    }
  }
}

// Typography override (10E) — size token + colour ROLE + alignment, all optional.
function validateFrameTypography(value: unknown, path: string, push: FramePush): void {
  if (!isRecord(value)) {
    push("error", path, "Typography must be a group of settings.");
    return;
  }
  if (value["size"] !== undefined && !inEnum(value["size"], FRAME_TYPO_SIZES)) {
    push("error", `${path}.size`, `The text size must be one of: ${FRAME_TYPO_SIZES.join(", ")}.`);
  }
  if (value["color"] !== undefined && !isFunnelTokenRole(value["color"])) {
    push("error", `${path}.color`, `The text colour must be a theme colour role: ${FUNNEL_TOKEN_ROLES.join(", ")}.`);
  }
  if (value["align"] !== undefined && !inEnum(value["align"], FRAME_ELEMENT_ALIGNS)) {
    push("error", `${path}.align`, `Alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
  }
}

// Compiled P2a condition group (10C CTA) — the SAME structural discriminator as
// content-schema validateConditional / runtime isConditionGroup: an array
// `conditions` ⇒ a group ({match ∈ all|any} + recurse); else a bare {when, op}.
function validateFrameCondition(value: unknown, path: string, push: FramePush): void {
  if (!isRecord(value)) {
    push("error", path, "A CTA condition must be a group of settings.");
    return;
  }
  if (Array.isArray(value["conditions"])) {
    const match = value["match"];
    if (match !== undefined && match !== "all" && match !== "any") {
      push("error", `${path}.match`, "A CTA condition group must match 'all' or 'any'.");
    }
    (value["conditions"] as unknown[]).forEach((c, i) => validateFrameCondition(c, `${path}.conditions[${i}]`, push));
    return;
  }
  if (!isNonEmptyString(value["when"])) {
    push("error", `${path}.when`, "A CTA condition needs a field to test.");
  }
  if (!isNonEmptyString(value["op"])) {
    push("error", `${path}.op`, "A CTA condition needs a comparison.");
  }
}

// Disclosure v2 entries (10H-adjacent) — a `custom` group field.
function validateDisclosureEntries(value: unknown, path: string, _label: string, push: FramePush): void {
  if (!Array.isArray(value)) {
    push("error", path, "Disclosure entries must be a list.");
    return;
  }
  value.forEach((entry, i) => {
    const p = `${path}[${i}]`;
    if (!isRecord(entry)) {
      push("error", p, "Each disclosure entry must be an entry with a location + text.");
      return;
    }
    if (!inEnum(entry["location"], FRAME_DISCLOSURE_V2_LOCATIONS)) {
      push("error", `${p}.location`, `A disclosure entry location must be one of: ${FRAME_DISCLOSURE_V2_LOCATIONS.join(", ")}.`);
    }
    if (typeof entry["text"] !== "string") {
      push("error", `${p}.text`, "A disclosure entry needs its text.");
    }
    if (!inEnum(entry["mode"], FRAME_DISCLOSURE_MODES)) {
      push("error", `${p}.mode`, `A disclosure entry mode must be one of: ${FRAME_DISCLOSURE_MODES.join(", ")}.`);
    }
    if (entry["align"] !== undefined && !inEnum(entry["align"], FRAME_ELEMENT_ALIGNS)) {
      push("error", `${p}.align`, `A disclosure entry alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
    }
    if (entry["link_label"] !== undefined && typeof entry["link_label"] !== "string") {
      push("error", `${p}.link_label`, "A disclosure entry link label must be plain text.");
    }
  });
}

// Footer v2 blocks (10H) — a `custom` group field.
function validateFooterBlocks(value: unknown, path: string, _label: string, push: FramePush): void {
  if (!Array.isArray(value)) {
    push("error", path, "Footer blocks must be a list.");
    return;
  }
  value.forEach((block, i) => {
    const p = `${path}[${i}]`;
    if (!isRecord(block)) {
      push("error", p, "Each footer block must be an entry with a type.");
      return;
    }
    if (!inEnum(block["type"], FRAME_FOOTER_BLOCK_TYPES)) {
      push("error", `${p}.type`, `A footer block type must be one of: ${FRAME_FOOTER_BLOCK_TYPES.join(", ")}.`);
    }
    if (block["text"] !== undefined && typeof block["text"] !== "string") {
      push("error", `${p}.text`, "A footer block's text must be plain text.");
    }
    if (block["links_source"] !== undefined && !inEnum(block["links_source"], FRAME_FOOTER_LINKS_SOURCES)) {
      push("error", `${p}.links_source`, `A footer link source must be one of: ${FRAME_FOOTER_LINKS_SOURCES.join(", ")}.`);
    }
    if (block["links"] !== undefined) {
      if (!Array.isArray(block["links"])) {
        push("error", `${p}.links`, "Footer links must be a list.");
      } else {
        (block["links"] as unknown[]).forEach((l, j) => {
          const lp = `${p}.links[${j}]`;
          if (!isRecord(l) || !isNonEmptyString(l["label"])) push("error", `${lp}.label`, "A footer link needs a label.");
          else if (!isNonEmptyString(l["href"]) || !SAFE_HREF_RE.test(String(l["href"]).trim())) {
            push("error", `${lp}.href`, "A footer link needs a web address (https://…), a page path (/…), or a #link.");
          }
        });
      }
    }
    if (block["socials"] !== undefined) {
      if (!Array.isArray(block["socials"])) {
        push("error", `${p}.socials`, "Footer social links must be a list.");
      } else {
        (block["socials"] as unknown[]).forEach((s, j) => {
          const sp = `${p}.socials[${j}]`;
          if (!isRecord(s) || !isNonEmptyString(s["platform"])) push("error", `${sp}.platform`, "A social link needs a platform.");
          else if (!isNonEmptyString(s["url"]) || !SAFE_HREF_RE.test(String(s["url"]).trim())) {
            push("error", `${sp}.url`, "A social link needs a web address (https://…).");
          }
        });
      }
    }
    if (block["align"] !== undefined && !inEnum(block["align"], FRAME_ELEMENT_ALIGNS)) {
      push("error", `${p}.align`, `A footer block alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
    }
  });
}

// 10E free_text — top-level list of {id, slot, blocks[], align?, typography?, pages?}.
function validateFreeText(value: unknown, push: FramePush): void {
  const base = "frame.free_text";
  if (!Array.isArray(value)) {
    push("error", base, "Free text must be a list of blocks.");
    return;
  }
  value.forEach((entry, i) => {
    const p = `${base}[${i}]`;
    if (!isRecord(entry)) {
      push("error", p, "Each free-text element must be an entry.");
      return;
    }
    if (!isNonEmptyString(entry["id"])) push("error", `${p}.id`, "A free-text element needs an id.");
    if (!inEnum(entry["slot"], FRAME_FREE_TEXT_SLOTS)) {
      push("error", `${p}.slot`, `A free-text slot must be one of: ${FRAME_FREE_TEXT_SLOTS.join(", ")}.`);
    }
    if (!Array.isArray(entry["blocks"]) || entry["blocks"].length === 0) {
      push("error", `${p}.blocks`, "A free-text element needs at least one text block.");
    } else {
      (entry["blocks"] as unknown[]).forEach((b, j) => {
        const bp = `${p}.blocks[${j}]`;
        if (!isRecord(b) || !inEnum(b["type"], FRAME_FREE_TEXT_BLOCK_TYPES)) {
          push("error", `${bp}.type`, `A text block type must be one of: ${FRAME_FREE_TEXT_BLOCK_TYPES.join(", ")}.`);
          return;
        }
        if (b["type"] === "list") {
          if (!Array.isArray(b["items"])) push("error", `${bp}.items`, "A list block needs a list of items.");
          if (b["style"] !== undefined && !inEnum(b["style"], FRAME_FREE_TEXT_LIST_STYLES)) {
            push("error", `${bp}.style`, `A list style must be one of: ${FRAME_FREE_TEXT_LIST_STYLES.join(", ")}.`);
          }
        }
      });
    }
    if (entry["align"] !== undefined && !inEnum(entry["align"], FRAME_ELEMENT_ALIGNS)) {
      push("error", `${p}.align`, `A free-text alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
    }
    if (entry["typography"] !== undefined) validateFrameTypography(entry["typography"], `${p}.typography`, push);
    if (entry["pages"] !== undefined) validateFramePageTarget(entry["pages"], `${p}.pages`, push);
  });
}

// 10F brand_logos — a single object {enabled, items[], layout, slot?, align?, pages?}.
function validateBrandLogos(value: unknown, push: FramePush): void {
  const base = "frame.brand_logos";
  if (!isRecord(value)) {
    push("error", base, "Brand logos must be a group of settings.");
    return;
  }
  if (typeof value["enabled"] !== "boolean") push("error", `${base}.enabled`, "Brand logos 'enabled' must be true or false.");
  if (!inEnum(value["layout"], FRAME_BRAND_LOGO_LAYOUTS)) {
    push("error", `${base}.layout`, `The brand-logos layout must be one of: ${FRAME_BRAND_LOGO_LAYOUTS.join(", ")}.`);
  }
  if (!Array.isArray(value["items"])) {
    push("error", `${base}.items`, "Brand logos must be a list of logos.");
  } else {
    (value["items"] as unknown[]).forEach((item, i) => {
      const p = `${base}.items[${i}]`;
      if (!isRecord(item)) {
        push("error", p, "Each brand logo must be an entry.");
        return;
      }
      const hasMedia = isNonEmptyString(item["media_id"]);
      const hasUrl = isNonEmptyString(item["url"]) && SAFE_HREF_RE.test(String(item["url"]).trim());
      if (!hasMedia && !hasUrl) {
        push("error", p, "A brand logo needs an uploaded image (media id) or a safe image URL.");
      }
      if (!isNonEmptyString(item["alt"])) push("error", `${p}.alt`, "A brand logo needs alt text.");
      if (item["size"] !== undefined && !inEnum(item["size"], FRAME_SIZES)) {
        push("error", `${p}.size`, `A brand-logo size must be one of: ${FRAME_SIZES.join(", ")}.`);
      }
    });
  }
  if (value["slot"] !== undefined && !inEnum(value["slot"], FRAME_FREE_TEXT_SLOTS)) {
    push("error", `${base}.slot`, `The brand-logos slot must be one of: ${FRAME_FREE_TEXT_SLOTS.join(", ")}.`);
  }
  if (value["align"] !== undefined && !inEnum(value["align"], FRAME_ELEMENT_ALIGNS)) {
    push("error", `${base}.align`, `The brand-logos alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
  }
  if (value["pages"] !== undefined) validateFramePageTarget(value["pages"], `${base}.pages`, push);
}

// 10C cta_slots — top-level list of placeable CTA/phone slots.
function validateCtaSlots(value: unknown, push: FramePush): void {
  const base = "frame.cta_slots";
  if (!Array.isArray(value)) {
    push("error", base, "CTA slots must be a list.");
    return;
  }
  value.forEach((slot, i) => {
    const p = `${base}[${i}]`;
    if (!isRecord(slot)) {
      push("error", p, "Each CTA slot must be an entry.");
      return;
    }
    if (!inEnum(slot["slot"], FRAME_CTA_SLOTS)) {
      push("error", `${p}.slot`, `A CTA slot must be one of: ${FRAME_CTA_SLOTS.join(", ")}.`);
    }
    if (typeof slot["label"] !== "string") push("error", `${p}.label`, "A CTA slot needs a label.");
    const tel = isNonEmptyString(slot["tel"]);
    const href = isNonEmptyString(slot["href"]);
    if (!tel && !href) {
      push("error", p, "A CTA slot needs a phone number or a link to point at.");
    }
    if (tel && !SAFE_TEL_RE.test(String(slot["tel"]).trim())) {
      push("error", `${p}.tel`, "The CTA phone number must look like +1 555 123 4567.");
    }
    if (href && !SAFE_HREF_RE.test(String(slot["href"]).trim())) {
      push("error", `${p}.href`, "The CTA link must be a web address (https://…), a page path (/…), a #link, or a tel:/mailto: link.");
    }
    if (slot["label"] === "" && !tel) {
      // an href-only slot with no label has no sensible default text.
      push("error", `${p}.label`, "A link CTA needs a label.");
    }
    if (slot["condition"] !== undefined && slot["condition"] !== null) {
      validateFrameCondition(slot["condition"], `${p}.condition`, push);
    }
  });
}

// 10G trust_rows — top-level list of icon+text rows.
function validateTrustRows(value: unknown, push: FramePush): void {
  const base = "frame.trust_rows";
  if (!Array.isArray(value)) {
    push("error", base, "Trust rows must be a list.");
    return;
  }
  value.forEach((row, i) => {
    const p = `${base}[${i}]`;
    if (!isRecord(row)) {
      push("error", p, "Each trust row must be an entry.");
      return;
    }
    if (!Array.isArray(row["items"]) || row["items"].length === 0) {
      push("error", `${p}.items`, "A trust row needs at least one item.");
    } else {
      (row["items"] as unknown[]).forEach((item, j) => {
        const ip = `${p}.items[${j}]`;
        if (!isRecord(item) || !isNonEmptyString(item["icon"])) push("error", `${ip}.icon`, "A trust-row item needs an icon.");
        if (!isRecord(item) || typeof item["text"] !== "string") push("error", `${ip}.text`, "A trust-row item needs text.");
        if (isRecord(item) && item["tooltip"] !== undefined && item["tooltip"] !== null && typeof item["tooltip"] !== "string") {
          push("error", `${ip}.tooltip`, "A trust-row tooltip must be plain text.");
        }
      });
    }
    if (row["align"] !== undefined && !inEnum(row["align"], FRAME_ELEMENT_ALIGNS)) {
      push("error", `${p}.align`, `A trust-row alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
    }
    if (row["slot"] !== undefined && !inEnum(row["slot"], FRAME_FREE_TEXT_SLOTS)) {
      push("error", `${p}.slot`, `A trust-row slot must be one of: ${FRAME_FREE_TEXT_SLOTS.join(", ")}.`);
    }
    if (row["pages"] !== undefined) validateFramePageTarget(row["pages"], `${p}.pages`, push);
  });
}

// 10G images (follow-on) — top-level list of independently-slotted placed
// images (a first-class element; mirrors free_text's per-item slot).
function validateImages(value: unknown, push: FramePush): void {
  const base = "frame.images";
  if (!Array.isArray(value)) {
    push("error", base, "Images must be a list.");
    return;
  }
  value.forEach((item, i) => {
    const p = `${base}[${i}]`;
    if (!isRecord(item)) {
      push("error", p, "Each image must be an entry.");
      return;
    }
    if (!isNonEmptyString(item["id"])) push("error", `${p}.id`, "An image needs an id.");
    const hasMedia = isNonEmptyString(item["media_id"]);
    const hasUrl = isNonEmptyString(item["url"]) && SAFE_HREF_RE.test(String(item["url"]).trim());
    if (!hasMedia && !hasUrl) {
      push("error", p, "An image needs an uploaded image (media id) or a safe image URL.");
    }
    if (!isNonEmptyString(item["alt"])) push("error", `${p}.alt`, "An image needs alt text.");
    if (!inEnum(item["slot"], FRAME_FREE_TEXT_SLOTS)) {
      push("error", `${p}.slot`, `An image slot must be one of: ${FRAME_FREE_TEXT_SLOTS.join(", ")}.`);
    }
    if (item["size"] !== undefined && !inEnum(item["size"], FRAME_SIZES)) {
      push("error", `${p}.size`, `An image size must be one of: ${FRAME_SIZES.join(", ")}.`);
    }
    if (item["align"] !== undefined && !inEnum(item["align"], FRAME_ELEMENT_ALIGNS)) {
      push("error", `${p}.align`, `An image alignment must be one of: ${FRAME_ELEMENT_ALIGNS.join(", ")}.`);
    }
    if (item["tooltip"] !== undefined && item["tooltip"] !== null && typeof item["tooltip"] !== "string") {
      push("error", `${p}.tooltip`, "An image tooltip must be plain text.");
    }
    if (item["pages"] !== undefined) validateFramePageTarget(item["pages"], `${p}.pages`, push);
  });
}

const FRAME_TOPLEVEL_CUSTOM: Record<string, (value: unknown, push: FramePush) => void> = {
  free_text: validateFreeText,
  brand_logos: validateBrandLogos,
  cta_slots: validateCtaSlots,
  trust_rows: validateTrustRows,
  images: validateImages,
};

export function validateFrameConfig(raw: unknown): FrameConfigValidation {
  const problems: Problem[] = [];
  const push = (severity: ProblemSeverity, path: string, message: string): void => {
    problems.push({ path, scope: "frame", severity, message });
  };

  if (!isRecord(raw)) {
    push("error", "frame", "Frame settings must be a JSON object.");
    return { config: null, problems };
  }

  for (const [key, value] of Object.entries(raw)) {
    if (key === "version") {
      if (value !== 1) push("error", "frame.version", "Frame settings version must be 1.");
      continue;
    }
    if (key === "template") {
      if (!isFrameTemplateId(value)) {
        push(
          "error",
          "frame.template",
          `The frame template must be one of: ${FRAME_TEMPLATE_IDS.join(", ")}.`,
        );
      }
      continue;
    }
    // Round-4 P5a — top-level authorable element groups (arrays / a single
    // object) that the group-spec machinery (object-of-scalar-fields) cannot
    // express. Checked BEFORE the group lookup; pre-P5a keys are unaffected.
    const topCustom = FRAME_TOPLEVEL_CUSTOM[key];
    if (topCustom !== undefined) {
      topCustom(value, push);
      continue;
    }
    const spec = FRAME_GROUP_SPECS[key];
    if (spec === undefined) {
      push("error", `frame.${key}`, `'${key}' isn't a recognised frame setting.`);
      continue;
    }
    validateGroup(key, spec, value, push);
  }

  // Cross-field rules (header).
  const header = raw["header"];
  if (isRecord(header)) {
    const cta = header["cta"];
    if (isRecord(cta) && cta["enabled"] === true) {
      if (!isNonEmptyString(cta["label"])) {
        push("error", "frame.header.cta.label", "The header call-to-action needs a label.");
      }
      if (!isNonEmptyString(cta["href"]) && !isNonEmptyString(cta["tel"])) {
        push(
          "error",
          "frame.header.cta",
          "The header call-to-action needs a phone number or a link to point at.",
        );
      }
    }
    if (header["logo_source"] === "manual") {
      // §4.4 — manual is Advanced-gated and stamps this warning.
      push("warning", "frame.header.logo_source", "Manual logo overrides site branding.");
      if (!isNonEmptyString(header["logo_media_id"])) {
        push(
          "error",
          "frame.header.logo_media_id",
          "Choose a logo image to use the manual logo option.",
        );
      }
    }
  }

  const hasErrors = problems.some((p) => p.severity === "error");
  return { config: hasErrors ? null : (raw as FrameConfig), problems };
}

function validateGroup(
  groupKey: string,
  spec: FrameGroupSpec,
  value: unknown,
  push: (severity: ProblemSeverity, path: string, message: string) => void,
): void {
  const basePath = `frame.${groupKey}`;
  if (!isRecord(value)) {
    push("error", basePath, `The ${spec.label} settings must be a group of settings.`);
    return;
  }
  for (const [key, fieldValue] of Object.entries(value)) {
    const field = spec.fields[key];
    if (field === undefined) {
      push("error", `${basePath}.${key}`, `'${key}' isn't a recognised ${spec.label} setting.`);
      continue;
    }
    validateField(fieldValue, field, `${basePath}.${key}`, `${spec.label} '${humanize(key)}'`, push);
  }
}

function validateField(
  value: unknown,
  spec: FrameFieldSpec,
  path: string,
  label: string,
  push: (severity: ProblemSeverity, path: string, message: string) => void,
): void {
  switch (spec.kind) {
    case "custom":
      spec.validate(value, path, label, push);
      return;
    case "object": {
      if (!isRecord(value)) {
        push("error", path, `The ${label} setting must be a group of settings.`);
        return;
      }
      for (const [key, nested] of Object.entries(value)) {
        const field = spec.fields[key];
        if (field === undefined) {
          push("error", `${path}.${key}`, `'${key}' isn't a recognised ${spec.label} setting.`);
          continue;
        }
        validateField(nested, field, `${path}.${key}`, `${spec.label} '${humanize(key)}'`, push);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        push("error", path, `The ${label} setting must be a list.`);
        return;
      }
      const fieldNames = Object.keys(spec.fields);
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        const item: unknown = value[i];
        if (!isRecord(item)) {
          push(
            "error",
            itemPath,
            `Each ${spec.itemLabel} must be an entry with ${fieldNames.join(" + ")}.`,
          );
          continue;
        }
        for (const key of Object.keys(item)) {
          if (!(key in spec.fields)) {
            push("error", `${itemPath}.${key}`, `'${key}' isn't a recognised ${spec.itemLabel} field.`);
          }
        }
        // Every declared field of a list entry is required.
        for (const [key, field] of Object.entries(spec.fields)) {
          validateField(item[key], field, `${itemPath}.${key}`, `${spec.itemLabel} '${humanize(key)}'`, push);
        }
      }
      return;
    }
    case "boolean":
      if (typeof value !== "boolean") push("error", path, `The ${label} setting must be true or false.`);
      return;
    case "enum":
      if (typeof value !== "string" || !spec.values.includes(value)) {
        push("error", path, `The ${label} setting must be one of: ${spec.values.join(", ")}.`);
      }
      return;
    case "text":
      if (typeof value !== "string") push("error", path, `The ${label} setting must be plain text.`);
      return;
    case "text_or_null":
      if (value !== null && typeof value !== "string") {
        push("error", path, `The ${label} setting must be plain text, or empty.`);
      }
      return;
    case "required_text":
      if (!isNonEmptyString(value)) push("error", path, `The ${label} field needs plain text.`);
      return;
    case "media_id":
      if (!isNonEmptyString(value)) {
        push("error", path, `The ${label} field must reference an uploaded image (its media id).`);
      }
      return;
    case "media_id_or_null":
      if (value !== null && !isNonEmptyString(value)) {
        push("error", path, `The ${label} setting must reference an uploaded image, or be empty.`);
      }
      return;
    case "role":
      if (!isFunnelTokenRole(value)) {
        push(
          "error",
          path,
          `The ${label} setting must be a theme colour role: ${FUNNEL_TOKEN_ROLES.join(", ")}.`,
        );
      }
      return;
    case "href":
      if (!isNonEmptyString(value) || !SAFE_HREF_RE.test(value.trim())) {
        push(
          "error",
          path,
          `The ${label} must be a web address (https://…), a page path (/…), a #section link, or a tel:/mailto: link.`,
        );
      }
      return;
    case "href_or_null":
      if (value !== null && (!isNonEmptyString(value) || !SAFE_HREF_RE.test(value.trim()))) {
        push(
          "error",
          path,
          `The ${label} must be a web address (https://…), a page path (/…), a #section link, or a tel:/mailto: link.`,
        );
      }
      return;
    case "tel_or_null":
      if (value !== null && (!isNonEmptyString(value) || !SAFE_TEL_RE.test(value.trim()))) {
        push(
          "error",
          path,
          `The ${label} must be a phone number (digits, spaces, +, dashes), like +1 555 123 4567.`,
        );
      }
      return;
  }
}

// ---------------------------------------------------------------------------
// §4.3 template switching — computeTemplateSwitch (C5).
//
// A switch is a per-GROUP three-way merge over the STORED sparse config (the
// effective result always recomputes through the SAME effectiveFrame, §13.2):
//
//   * OPERATOR CONTENT is PRESERVED VERBATIM — copy (tagline, back/CTA labels,
//     disclosure text, trust text, footer description, benefit items), media
//     (`logo_media_id`, trust logos + alts, background image), legal links,
//     palette-role picks (progress.color_role / background.role /
//     continue_style_role) and policy fields (links_source, trust source,
//     footer scheduling, compat, history_fallback…).
//   * LAYOUT / POSITION fields are REPLACED by the target template's defaults —
//     implemented by DROPPING those keys from the sparse patch so the new
//     template's defaults apply (region positions, progress style+position
//     defaults, section_slot geometry, alignment, sticky, the whole sparse
//     `mobile` override group, and `header.logo_source` — every template
//     curates site branding, which is exactly why a manual logo stops
//     rendering on switch, confirmation (c)).
//   * REGION AVAILABILITY (`enabled` flags of the toggleable regions) is
//     preserved where the target template supports the region
//     (TEMPLATE_REGION_SUPPORT, derived from the §4.3 arrangement rows);
//     an unsupported-but-enabled region drops its stored `enabled` key so the
//     target default (off) applies — the region stops rendering while its
//     CONTENT stays in the config, inert ("its 3 items are kept but won't
//     show"). Data is never deleted by a switch: default-enabled regions
//     (e.g. the footer after minimal → centered) revive automatically on
//     switch-back; content-requiring regions revive their data the moment the
//     operator re-enables them.
//
// Confirmations are REQUIRED (returned as dialog lines) when:
//   (a) an effectively-enabled region is not part of the target template —
//       the line names exactly what stops rendering;
//   (b) `section_slot.card` behaviour changes (card ⇄ bare);
//   (c) a manual logo would stop rendering (logo_source resets to the
//       target's curated site branding; the image is kept) or a background
//       image sits under a background arrangement the switch replaces.
//
// PURE + non-mutating: preview-before-apply posts the merged result as
// `draft_frame_config` (13 §13.4) — nothing persists until Save (C5).
// ---------------------------------------------------------------------------

// The toggleable frame regions a template arrangement can feature (§4.3).
export const FRAME_SWITCH_REGIONS = [
  "header",
  "disclosure",
  "footer",
  "trust_strip",
  "benefit_bar",
] as const;

export type FrameSwitchRegion = (typeof FRAME_SWITCH_REGIONS)[number];

const FRAME_SWITCH_REGION_LABELS: Record<FrameSwitchRegion, string> = {
  header: "Header",
  disclosure: "Disclosure",
  footer: "Footer",
  trust_strip: "Trust strip",
  benefit_bar: "Benefit bar",
};

// §4.3 arrangement rows → the regions each template features. header is part
// of every arrangement (every row starts with a logo/header band); disclosure
// is a compliance affordance with four location legs (11 §11.4) and is
// supported everywhere; footer is absent only from `minimal` ("no footer");
// the trust strip features in `centered` + `white-trust`; the benefit bar only
// in `header-cta`.
export const TEMPLATE_REGION_SUPPORT: Record<FrameTemplateId, ReadonlySet<FrameSwitchRegion>> = {
  centered: new Set<FrameSwitchRegion>(["header", "disclosure", "footer", "trust_strip"]),
  "header-footer": new Set<FrameSwitchRegion>(["header", "disclosure", "footer"]),
  "header-cta": new Set<FrameSwitchRegion>(["header", "disclosure", "footer", "benefit_bar"]),
  "full-background": new Set<FrameSwitchRegion>(["header", "disclosure", "footer"]),
  "white-trust": new Set<FrameSwitchRegion>(["header", "disclosure", "footer", "trust_strip"]),
  minimal: new Set<FrameSwitchRegion>(["header", "disclosure"]),
};

// The LAYOUT/POSITION fields per group (§4.3 class table) — dropped from the
// sparse stored patch on switch so the target template's defaults apply.
// Everything NOT listed here is operator content/policy and rides verbatim.
const SWITCH_LAYOUT_FIELDS: Record<string, readonly string[]> = {
  header: ["logo_source", "logo_size", "logo_align", "sticky"],
  progress: ["style", "position", "thickness", "width", "show_label"],
  back: ["style", "position"],
  disclosure: ["location"],
  footer: [], // no geometry fields — links/copy/scheduling are operator data
  trust_strip: ["placement"],
  benefit_bar: ["placement"],
  background: ["style"],
  section_slot: [
    "max_width",
    "align",
    "card",
    "padding",
    "offset_y",
    "transition",
    "continue_placement",
  ],
  compat: [],
};

// Content-kept phrase for the (a) confirmation line — names what is kept
// (matches the §4.3 example: "its 3 items are kept but won't show").
function regionKeptPhrase(region: FrameSwitchRegion, group: Record<string, unknown> | null): string {
  if (region === "benefit_bar" && group !== null && Array.isArray(group["items"]) && group["items"].length > 0) {
    const n = group["items"].length;
    return `its ${n} item${n === 1 ? "" : "s"} are kept but`;
  }
  if (region === "trust_strip" && group !== null && Array.isArray(group["logos"]) && group["logos"].length > 0) {
    const n = group["logos"].length;
    return `its ${n} logo${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} kept but`;
  }
  return "its settings are kept but";
}

export interface TemplateSwitchResult {
  merged: StoredFrameConfig;
  confirmations: string[];
}

export function computeTemplateSwitch(
  currentStored: StoredFrameConfig | null,
  targetTemplateId: string,
): TemplateSwitchResult {
  const confirmations: string[] = [];

  // Unknown target id → `centered` (mirror of the §4.3 stored-id fallback).
  let target: FrameTemplateId;
  if (isFrameTemplateId(targetTemplateId)) {
    target = targetTemplateId;
  } else {
    target = DEFAULT_FRAME_TEMPLATE_ID;
    confirmations.push(
      `The '${targetTemplateId}' frame template isn't available any more — switching to '${DEFAULT_FRAME_TEMPLATE_ID}' instead.`,
    );
  }
  const targetDefaults = FRAME_TEMPLATES[target].defaults;
  const support = TEMPLATE_REGION_SUPPORT[target];

  // First adoption (no stored frame): nothing to merge, nothing to lose.
  if (currentStored === null) {
    return { merged: { version: 1, template: target }, confirmations };
  }

  // What the funnel currently renders — the confirmation triggers compare
  // EFFECTIVE current against the target's defaults (stored layout keys are
  // dropped, so the target default is what the merged config will show).
  const currentEffective = effectiveFrame(currentStored).frame;

  const merged: Record<string, unknown> = { version: 1, template: target };
  for (const [groupKey, groupValue] of Object.entries(currentStored)) {
    if (groupKey === "version" || groupKey === "template") continue;
    if (groupKey === "mobile") continue; // sparse layout overrides — replaced whole
    if (!isRecord(groupValue)) continue; // junk survives validation elsewhere, never a switch
    const layoutFields = SWITCH_LAYOUT_FIELDS[groupKey] ?? [];
    const kept: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(groupValue)) {
      if (layoutFields.includes(field)) continue; // layout/position → target default
      if (
        field === "enabled" &&
        (FRAME_SWITCH_REGIONS as readonly string[]).includes(groupKey) &&
        !support.has(groupKey as FrameSwitchRegion)
      ) {
        continue; // unsupported region: availability falls to the target default (off)
      }
      kept[field] = value;
    }
    if (Object.keys(kept).length > 0) merged[groupKey] = kept;
  }
  const mergedConfig = cloneJson(merged) as StoredFrameConfig;

  // (a) enabled-but-unsupported regions — name exactly what stops rendering.
  for (const region of FRAME_SWITCH_REGIONS) {
    if (support.has(region)) continue;
    const effectiveGroup = currentEffective[region] as unknown as Record<string, unknown>;
    if (effectiveGroup["enabled"] !== true) continue;
    const storedGroup = isRecord(currentStored[region as keyof StoredFrameConfig])
      ? (currentStored[region as keyof StoredFrameConfig] as Record<string, unknown>)
      : null;
    confirmations.push(
      `${FRAME_SWITCH_REGION_LABELS[region]} isn't part of '${target}' — ${regionKeptPhrase(region, storedGroup)} won't show.`,
    );
  }

  // (b) section_slot.card behaviour change (card ⇄ bare).
  const cardBefore = currentEffective.section_slot.card;
  const cardAfter = targetDefaults.section_slot.card;
  if (cardBefore !== cardAfter) {
    const word = (v: (typeof FRAME_SLOT_CARDS)[number]): string =>
      v === "card" ? "a card" : "a bare layout";
    confirmations.push(`The question unit changes from ${word(cardBefore)} to ${word(cardAfter)}.`);
  }

  // (c) manual logo — logo_source resets to the target's curated site
  // branding (a layout-replaced field), so a manual logo stops rendering; the
  // image reference is kept.
  if (
    currentEffective.header.enabled &&
    currentEffective.header.logo_source === "manual" &&
    currentEffective.header.logo_media_id !== null
  ) {
    confirmations.push(
      `The manual logo stops rendering — '${target}' uses the site logo by default (the image is kept and revives when you re-select Manual).`,
    );
  }

  // (c) background image — kept verbatim (§4.3 media row), but flag when the
  // switch replaces the background arrangement it sits under.
  if (
    currentEffective.background.image_media_id !== null &&
    currentEffective.background.style !== targetDefaults.background.style
  ) {
    confirmations.push(
      `The background arrangement changes under your background image — check it still renders as intended (the image is kept).`,
    );
  }

  return { merged: mergedConfig, confirmations };
}

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
