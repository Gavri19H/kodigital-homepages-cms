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
//     KNOWN, and so never rejected: the v3.1 §10.1/§11.1 per-variant theme
//     reference `theme_id`, a real key of the frame-overrides document
//     (shape-checked here; its meaning and KV lookup belong to the theme /
//     handler layers).

import { funnelTokenRoleLabelList, isFunnelTokenRole, THEME_RECORD_FONT_NAMES } from "./theme";
import type { FunnelTokenRole, Problem, ProblemSeverity, VariantThemeOverrides } from "./theme";
import { sanitizeFrameInlineHtml } from "../../../lib/inline-sanitizer";

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
// R2 P8 (§7 N12 — "Logo Alignment offers Left/Center; progress Alignment offers
// Left/Center/Right"). The asymmetry was real and its cause was the STYLESHEET:
// default-funnel/styles.ts declared `.lg-frame-header--left` and `--center` and
// no `--right`, so a `right` logo could not have been honoured. That rule now
// exists (the same one-property mirror of `--left`, on the same flex
// `.lg-header-inner`, plus the extras band's own mirror), so the two vocabularies
// are one vocabulary. ADDITIVE: no stored config carries `right`, so every
// existing funnel renders byte-identically.
export const FRAME_LOGO_ALIGNS = ["left", "center", "right"] as const;
// Round-4 P5a (10D / B-4.7): `icon_on_track` is a REAL fifth visible style
// (a theme-icon thumb riding the fill edge) — `numbered` stops being a fake
// alias of `bar` (frame.ts renders distinct numbered-circle markup; styles.ts
// gives every style a distinct rule). ADDITIVE to the enum: pre-P5a stored
// configs never carry `icon_on_track`, so validation/round-trip are unchanged.
export const FRAME_PROGRESS_STYLES = ["hidden", "bar", "dots", "numbered", "percent", "icon_on_track"] as const;
// R2 P7 (owner: "I chose 'icon on track' - where is the icon on track??? how do
// I define it????"). WHICH mark rides the track is now authorable, not implied:
// five built-in glyphs plus the previewed site's own logo. `dot` is the default
// and reproduces the pre-P7 plain round thumb byte-for-byte, so every stored
// config that predates this key renders exactly as it did.
// R2 P8 FIX ROUND F1 (M1 + R7, the SAME owner sentence): `custom` is the
// operator's OWN image, chosen with the media path this admin already authors
// the header logo, the trust logos, the background image and the footer logo
// with (mediaPickerControl / mediaFieldMarkup). It lands only because all four
// pieces it needs land together — the enum id here, the PAINT
// (default-funnel/styles.ts now emits the image-mark pseudo pair for
// `.lg-frame-progress--icon-custom` exactly as it has for `--icon-site_logo`
// since P7), the operator control (quotes-tabs/templates.ts) and the M2 sweep's
// own universe (leadgen-r2-dead-controls-guard). An earlier attempt widened the
// enum ALONE: the mark is selected by that class, so a `custom` id with no rule
// behind it is a control that cannot be honoured (§4 R3) and it was correctly
// reverted. NO renderer is invented — `custom` walks the identical
// resolve-URL → CSS-custom-property → pseudo-pair path `site_logo` already
// walks, with the URL coming from the operator's media pick instead of the
// previewed site's branding, and falling back to the plain `dot` thumb whenever
// no usable image is authored (same fail-safe, same code path).
export const FRAME_PROGRESS_ICONS = ["dot", "car", "shield", "check", "star", "site_logo", "custom"] as const;
export type FrameProgressIconId = (typeof FRAME_PROGRESS_ICONS)[number];
export const FRAME_PROGRESS_POSITIONS = ["top", "under_header", "above_unit", "in_card"] as const;
export const FRAME_PROGRESS_ALIGNS = ["left", "center", "right"] as const;
export const FRAME_PROGRESS_WIDTHS = ["content", "full"] as const;
export const FRAME_BACK_STYLES = ["hidden", "text", "icon_text", "button"] as const;
export const FRAME_BACK_POSITIONS = ["under_header_left", "in_card", "below_card", "footer"] as const;
export const FRAME_DISCLOSURE_LOCATIONS = ["top_bar", "header", "footer", "modal"] as const;
export const FRAME_FOOTER_SHOW_ON = ["all", "first", "final", "never"] as const;
export const FRAME_FOOTER_LINKS_SOURCES = ["site", "manual"] as const;
// R2 P3 (element J) D2 — link_row's OWN links_source widens with "picked"
// (S3b's Pages-fed legal-links leg): an operator picks specific site pages by
// their stable page_type identity; leadgen/branding.ts resolvePickedLegalPageLinks
// resolves them per SERVING site at serve time. Scoped to link_row only (NOT
// FRAME_FOOTER_LINKS_SOURCES itself, which the top-level legacy footer.links_source
// and the "logo" block's logo_source above also use — "picked" has no meaning
// for either of those, so the enum they validate against stays site|manual).
export const FRAME_FOOTER_LINK_ROW_SOURCES = ["site", "manual", "picked"] as const;
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

// 10H footer v2 block model. R2 P3 (element J, SOURCE-OF-TRUTH A.2): "heading"
// and "list" extend the free-text block-type model (FRAME_FREE_TEXT_BLOCK_TYPES)
// into the footer so the owner's Image45 multi heading+paragraph pattern is
// authorable; about_paragraph/disclosure/heading all carry the SAME optional
// `html` rich-text field below (bold/italic/link via the reused toolbar).
// OWNER 2026-08-23: "Add the ability to use dividers between blocks similar to
// the one appearing in the attached screenshot" — a divider is a BLOCK, not a
// per-block flag, because his reference puts one in only two of ten gaps. As a
// block type it inherits the add / reorder / remove machinery the operator
// already drives, and it carries no fields of its own (the rule takes its
// colour from the footer's own text colour — see styles.ts).
export const FRAME_FOOTER_BLOCK_TYPES = [
  "about_paragraph",
  "link_row",
  "disclosure",
  "logo",
  "address",
  "socials",
  "heading",
  "list",
  "divider",
] as const;

// OWNER 2026-08-23: "some of the blocks sit really tight, and it looks weird.
// The user should be able to increase / decrease the spacing between blocks."
// Measured before the fix, the gaps came from eight independent hardcoded
// per-block margins: 8px paragraph→paragraph, 16px heading→heading, 4px
// heading→disclosure and 0px (touching) for logo→socials and socials→socials.
// ONE gap axis replaces all eight; these five steps map to the design's own
// spacing tokens in styles.ts, so this is never an arbitrary CSS length.
export const FRAME_FOOTER_BLOCK_GAPS = ["xs", "s", "m", "l", "xl"] as const;

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
  // R2 P7: which mark rides the track when style === "icon_on_track". OPTIONAL
  // + absent from defaults (frame.ts falls back to "dot", the pre-P7 look), so
  // no stored config changes shape. Ignored by every other style.
  icon?: (typeof FRAME_PROGRESS_ICONS)[number];
  // R2 P8 F1: the operator's own image for `icon:"custom"` — a media id, the
  // SAME reference shape header.logo_media_id / background.image_media_id carry
  // (resolved through mediaUrl at render time). OPTIONAL + absent from defaults
  // and read by exactly one branch, so every stored config is unchanged; an
  // absent/unusable ref renders the plain `dot` thumb rather than an empty mark.
  icon_media_id?: string | null;
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

// R2 P3 (element J) D2 — one operator pick from S3b's Pages-fed legal-links
// picker (leadgen/branding.ts SiteBrandingLegalPagePick — SAME shape, kept
// structurally compatible so a link_row block's `picks` passes straight
// through to resolveSiteBranding's 3rd arg with no reshaping). `page_type`
// is the stable cross-site identity; `label` is author-controlled and rides
// unchanged across every serving site; `manual_url` is the D2 fallback used
// only when the serving site has no page of that type.
// R2 P3 FIX-FIRST (BLOCKER-2) — `page_type` alone is NOT a unique identity.
// A stock CMS site auto-seeds contact / do-not-sell / privacy-policy / terms
// ALL as page_type:"legal" (site-provisioning legal-renderer), and
// leadgen/branding.ts's resolver maps first-wins PER TYPE — so four distinct
// picks silently collapsed onto ONE page, making Image28's six distinct legal
// links unbuildable on a default site. `slug` is the per-site UNIQUE key
// (migration 0007 idx_pages_site_slug_unique) that stock sites nonetheless
// SHARE across sites (the seeder writes the same LEGAL_TEMPLATE_SLUGS
// everywhere), so it distinguishes the four "legal" rows while still
// resolving against whichever site serves the funnel — the D2 semantic.
// BACK-COMPAT: `slug` is OPTIONAL and `page_type` stays REQUIRED; a pick
// saved before this fix (page_type only) resolves through the UNCHANGED
// page_type path, and a slug that the serving site does not have also falls
// back to page_type, then to manual_url, then omission.
export interface FrameFooterLegalPagePick {
  page_type: string;
  label: string;
  slug?: string;
  manual_url?: string;
}

// Round-4 P5a (10H) footer v2 — a block. One `type` per row; only that type's
// fields are read (extra fields are ignored at render, rejected at validate).
export interface FrameFooterSocialLink {
  platform: string; // label/icon key (escaped)
  url: string; // SAFE_HREF gated
}
export interface FrameFooterBlock {
  type: (typeof FRAME_FOOTER_BLOCK_TYPES)[number];
  text?: string; // about_paragraph / disclosure / address copy (plain)
  links_source?: (typeof FRAME_FOOTER_LINK_ROW_SOURCES)[number]; // link_row
  links?: FrameFooterLink[]; // link_row (manual)
  // link_row, links_source:"picked" (D2) — resolved server-side per serving
  // site into branding.legal_links (leadgen/branding.ts resolveSiteBranding's
  // 3rd arg); frame.ts's link_row case reads branding.legal_links for BOTH
  // "site" and "picked" (the resolution already happened by the time it runs).
  picks?: FrameFooterLegalPagePick[];
  socials?: FrameFooterSocialLink[]; // socials
  align?: (typeof FRAME_ELEMENT_ALIGNS)[number];
  // R2 P3 (element J) — about_paragraph/disclosure/heading rich text: author
  // html sanitized via sanitizeFrameInlineHtml at STORE time below (mirrors
  // validateFreeText's b["html"] rewrite 1:1, same allowlisted tag set —
  // bold/italic/link). `level` is forward capability for a heading block
  // (mirrors FrameFreeTextBlock.level); no UI exposes it yet, same as there.
  html?: string;
  level?: number;
  // "list" type — mirrors FrameFreeTextBlock items/style exactly (each item
  // sanitized the same way).
  items?: string[];
  list_style?: (typeof FRAME_FREE_TEXT_LIST_STYLES)[number];
  // "logo" type — site branding logo (unchanged default) OR a manual
  // media/URL override, reusing FRAME_FOOTER_LINKS_SOURCES's own site|manual
  // enum (the SAME "where does this asset come from" choice link_row already
  // makes) rather than a new near-duplicate const.
  logo_source?: (typeof FRAME_FOOTER_LINKS_SOURCES)[number];
  logo_media_id?: string | null;
  logo_url?: string;
  logo_alt?: string;
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
  // R2 P3 (element J) — the owner's "different color, font and sizes than the
  // main template". A CLOSED enum, reusing theme.ts's OWN pre-vetted
  // headline_font/body_font vocabulary (THEME_RECORD_FONT_NAMES) rather than
  // an unconstrained string — see theme.ts's "P0 STORED-XSS FIX" comment on
  // why an unconstrained font-family string is a documented CSS/style-block
  // injection sink in this exact codebase; this field must never repeat that.
  font_family?: (typeof THEME_RECORD_FONT_NAMES)[number];
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
  // R2 P3 FIX-FIRST (MAJOR-5) — the owner's Image45 pin shows UNDERLINED
  // legal links; styles.ts hard-codes `text-decoration:none` on
  // .lg-frame-footer2-link with no operator control, so that pin was not
  // deliverable at all. The footer owns its own styling per A.2 ("different
  // color, font and sizes then the main template"), so the axis belongs to
  // the footer's OWN design box. ABSENT/false → today's behavior byte-for-
  // byte (frame.ts emits no custom property, styles.ts falls to `none`).
  link_underline?: boolean;
  // R2 P3 FIX-FIRST (MINOR-8) — Image28 separates its six legal links with
  // " | ". The separator is authorable text rendered BETWEEN the anchors of a
  // link_row (never inside one, never a link itself); ABSENT/null → the
  // pre-fix gap-only row, byte-identical.
  link_separator?: string | null;
  // OWNER 2026-08-23 — the spacing between footer blocks, one axis for all of
  // them. ABSENT → styles.ts's own default (the widest gap the old per-block
  // margins produced), so no authored footer gets tighter than it was.
  block_gap?: (typeof FRAME_FOOTER_BLOCK_GAPS)[number];
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
// v3.1 §10.1/§11.1 — the column also holds the per-variant theme REFERENCE
// `theme_id` ("A/B frame + theme_id overrides"). Like `theme` it is consumed
// by the theme layer (winningThemeId), not by the frame merge; it is declared
// here because it is part of THIS document's schema, which is why
// validateFrameConfig recognises it (see its theme_id branch).
export type FrameOverrides = StoredFrameConfig & {
  theme?: VariantThemeOverrides;
  theme_id?: string;
};

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
//
// Rework M5 (§5) — 4th argument `savedTemplateDefaults`: the CALLER-resolved
// `leadgen_frame_templates` row the funnel/variant's `frame_template_id`
// points to (variant.frame_template_id ?? funnel.frame_template_id — the
// query/lookup is the CALLER's job; this module owns no DB access), ALREADY
// PARSED to the `frame_json` shape (== FRAME_TEMPLATES[].defaults per M5's
// own contract — "the FrameConfig per-group defaults shape"). When provided
// (non-null/undefined) it becomes the base layer INSTEAD OF the templateId
// string lookup below — the ftid wins outright over whatever
// frame_config_json.template names (M5 order: "template(variant.ftid ??
// funnel.ftid).defaults ⊕ funnel.frame_config ⊕ variant.overrides"). Omitted
// (every pre-M5 call site) ⇒ the templateId-string branch below runs
// UNCHANGED — byte-identical legacy behavior ("when neither ftid is set").
export function effectiveFrame(
  template: FrameTemplateId | string | StoredFrameConfig | null | undefined,
  frame_config_json?: StoredFrameConfig | null,
  frame_overrides_json?: FrameOverrides | null,
  savedTemplateDefaults?: EffectiveFrameConfig | null,
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
  let frame: EffectiveFrameConfig;
  if (savedTemplateDefaults !== null && savedTemplateDefaults !== undefined) {
    // M5: the ftid resolution wins outright — never "unknown" (a stale/
    // deleted ftid is the CALLER's problem to detect via its own row lookup
    // returning null, in which case it simply omits this argument and falls
    // to the legacy branch below).
    //
    // FIX (P5 sweep, product-bug round, 2026-07-23): `templateId`/
    // `frame.template` MUST come from the SAVED TEMPLATE's own recorded
    // arrangement family (savedTemplateDefaults.template), NEVER from
    // `requested` (the FUNNEL's stale frame_config_json.template). The
    // funnel's own template string describes what it was BEFORE this ftid
    // applied — using it here stamped the WRONG identity onto the live
    // frame: applying "Minimal" over a "Centered" funnel correctly flipped
    // every field (frame = cloneJson(savedTemplateDefaults) below always
    // did), but `.lg-frame--{template}` / `data-frame-template` (designs/
    // frame.ts) kept reading "centered" — the funnel's leftover identity,
    // not the template that's actually rendering. Investigated what
    // consumes this string before picking the fix: NO existing CSS rule is
    // keyed on `.lg-frame--{builtinId}` itself (only the UNRELATED mobile
    // modifier classes, lg-frame--m-logo-*/m-trust-*/m-progress-*, are
    // ever styled) — so `frame.template`'s job is exactly what the M5
    // comment above already says: "a recognizable built-in-or-default id
    // purely for callers keying UI/analytics off that string." A saved
    // template's `frame_json` (this module's OWN 4th-arg contract, see the
    // comment above this function) is validated at save time to be a
    // FrameConfig — its OWN `.template` key, when authored, is ALSO
    // validated as a real FrameTemplateId (validateFrameConfig's `template`
    // check applies uniformly to every save, built-in-derived or not) —
    // meaning it already records WHICH of the 6 built-in arrangement
    // families this saved template's layout belongs to (studio "Save
    // template" flows start from one of the 6 and customize FIELDS, never
    // the arrangement family itself). Stamping THAT is the "honest
    // identity": a saved template whose layout mirrors "Minimal" stamps
    // "minimal" — coherent with any future `.lg-frame--minimal` CSS a
    // custom stylesheet might add, applying uniformly to the built-in AND
    // every saved template sharing that arrangement family. A saved row
    // that genuinely omits `template` (a sparse FrameConfig patch — legal
    // per this module's OWN sparse-patch contract, despite
    // parseSavedFrameTemplateDefaults's EffectiveFrameConfig cast at the
    // read boundary) falls back to DEFAULT_FRAME_TEMPLATE_ID, the SAME
    // silent (never-"unknown") default every other branch of this
    // conditional already uses — no new problem path invented.
    templateId = isFrameTemplateId(savedTemplateDefaults.template) ? savedTemplateDefaults.template : DEFAULT_FRAME_TEMPLATE_ID;
    // R2 P3 BLOCKER FIX (sparse saved template 500): this branch used to be
    // `frame = cloneJson(savedTemplateDefaults)` — it treated the saved row as
    // if it were already a COMPLETE EffectiveFrameConfig. It is not. The write
    // path (frame-handlers validateTemplateInput → validateFrameConfig) accepts
    // a SPARSE FrameConfig patch (that is this module's own documented stored
    // shape, and exactly what the Templates tab saves when the operator edits
    // only the footer), and parseSavedFrameTemplateDefaults merely CASTS that
    // sparse object to EffectiveFrameConfig at the read boundary (see its own
    // comment). Cloning it therefore produced a frame with whole groups
    // MISSING — `frame.section_slot` undefined — and every consumer that reads
    // a group unconditionally (serve.ts renderVariantSectionsHtml's
    // `frame.section_slot.continue_placement`, frame.ts renderSlotRegion, …)
    // threw, 500ing the WHOLE public page for any funnel seeded from a saved
    // footer template.
    //
    // The canonical defaults are the ones this function ALREADY composes for
    // every other branch: FRAME_TEMPLATES[templateId].defaults — the arrangement
    // family the saved row itself records (templateId, resolved one line above
    // from savedTemplateDefaults.template, DEFAULT_FRAME_TEMPLATE_ID when the
    // sparse row omits it). So the saved template becomes what it always was
    // meant to be — a PATCH over its own family's defaults — merged with the
    // SAME mergeInto the funnel/override layers below already use. No value is
    // invented here.
    //
    // Byte-identical for a COMPLETE saved template (the pre-P3 shape M5's own
    // contract describes: "== FRAME_TEMPLATES[].defaults"): every key it
    // defines overwrites the base, arrays replace whole, explicit nulls
    // replace — so mergeInto(base, complete) === cloneJson(complete). The
    // ONLY behavior change is for keys a SPARSE row omits, which used to be
    // `undefined` (i.e. the crash) and are now that family's default.
    frame = cloneJson(FRAME_TEMPLATES[templateId].defaults);
    mergeInto(frame as unknown as Record<string, unknown>, savedTemplateDefaults as unknown as Record<string, unknown>);
  } else if (requested === undefined) {
    templateId = DEFAULT_FRAME_TEMPLATE_ID;
    frame = cloneJson(FRAME_TEMPLATES[templateId].defaults);
  } else if (isFrameTemplateId(requested)) {
    templateId = requested;
    frame = cloneJson(FRAME_TEMPLATES[templateId].defaults);
  } else {
    templateId = DEFAULT_FRAME_TEMPLATE_ID;
    frame = cloneJson(FRAME_TEMPLATES[templateId].defaults);
    problems.push({
      path: "frame.template",
      scope: "frame",
      severity: "warning",
      message: `The '${requested}' frame template isn't available any more — showing the '${DEFAULT_FRAME_TEMPLATE_ID}' layout instead.`,
    });
  }

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

// Rework M5 (§5, S2.2 follow-up) — normalizes a `leadgen_frame_templates.
// frame_json` column value into the EffectiveFrameConfig shape effectiveFrame's
// 4th argument expects. Pure/sync, NO DB access — the row fetch (SELECT ...
// FROM leadgen_frame_templates WHERE id = ?) is each CALLER's own job,
// mirroring its local D1 conventions (same division of labor as
// effectiveFrame's own 4th-arg comment above: "this module owns no DB
// access"). validateTemplateInput (frame-handlers.ts) already gates every
// SAVE with validateFrameConfig (zero error-severity problems); this
// defensively re-validates on READ instead of trusting the write-time
// guarantee blindly (D1 rule: a corrupt/malformed JSON column degrades to
// null, never throws). A null/malformed/absent column ⇒ null ⇒ the caller
// omits effectiveFrame's 4th arg ⇒ byte-identical legacy path.
export function parseSavedFrameTemplateDefaults(raw: string | null | undefined): EffectiveFrameConfig | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const validation = validateFrameConfig(parsed as Record<string, unknown>);
  return validation.config === null ? null : (validation.config as EffectiveFrameConfig);
}

// R2 P3 (element J) D2 — the ONE place that knows how to find a saved
// legal-page pick set inside an effective frame's footer.blocks (the
// link_row block authored with links_source:"picked"). Every serve/preview
// orchestration call site that owns a resolveSiteBranding call reads THIS
// instead of re-deriving the same footer.blocks scan independently at each
// of the (currently 5) call sites — a single source of truth for "how do we
// find J's picks," so they can never drift out of step with each other or
// with the editor's own shape. The FIRST picked link_row block with a
// non-empty picks array wins (mirrors this codebase's "first-wins" idiom
// elsewhere — e.g. leadgen/branding.ts's per-page-type tie-break). Undefined
// when none exists — the caller's resolveSiteBranding(db, siteId) 2-arg
// call stays byte-identical for every funnel that has no picked link_row.
export function footerLegalPagePicks(
  frame: Pick<EffectiveFrameConfig, "footer"> | EffectiveFrameConfig | null | undefined,
): FrameFooterLegalPagePick[] | undefined {
  const blocks = frame?.footer?.blocks;
  if (!Array.isArray(blocks)) return undefined;
  for (const block of blocks) {
    if (block.type === "link_row" && block.links_source === "picked" && Array.isArray(block.picks) && block.picks.length > 0) {
      return block.picks;
    }
  }
  return undefined;
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
// REJECTED (top level, group level, nested objects, list entries) — `theme_id`
// (v3.1 §10.1) is a KNOWN top-level key, shape-checked, never rejected; colours are
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
// R2 P3 (element J, contract R2 minor-6) — EXPORTED so designs/frame.ts (the
// singular render module) can import this ONE instance directly rather than
// a third re-declared copy, and re-check every footer href it renders
// (link_row/socials/manual logo) at render time too (defense in depth over
// this module's own STORE-time validateFooterBlocks gate).
export const SAFE_HREF_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

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
      icon: oneOf(FRAME_PROGRESS_ICONS), // R2 P7 — which mark rides the track
      // R2 P8 F1 — the operator's own image behind icon:"custom". Same spec as
      // header.logo_media_id / background.image_media_id: a media id or empty.
      icon_media_id: { kind: "media_id_or_null" },
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
        fields: { size: oneOf(FRAME_TYPO_SIZES), font_family: oneOf(THEME_RECORD_FONT_NAMES) },
      },
      // R2 P3 FIX-FIRST — the footer's own link-decoration axis (MAJOR-5) and
      // the Image28 link separator (MINOR-8). Plain existing kinds: a boolean
      // and nullable plain text (escaped at render, never a markup sink).
      link_underline: bool,
      link_separator: textOrNull,
      // OWNER 2026-08-23 — the block-spacing axis (a closed token step, never
      // an arbitrary CSS length).
      block_gap: oneOf(FRAME_FOOTER_BLOCK_GAPS),
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

// P8-6 Q7 (M5 jargon sweep, "close the raw-key-dump class for good"):
// converged VERBATIM with quotes-tabs/templates.ts's own enumOptions()/
// frameSelect() label maps for these controls — kept as local data for the
// same PURE-module reason theme.ts's FUNNEL_TOKEN_ROLE_LABELS is local
// (several admin files import validateFrameConfig FROM this module).
// FRAME_ELEMENT_ALIGNS / FRAME_DISCLOSURE_V2_LOCATIONS /
// FRAME_FREE_TEXT_BLOCK_TYPES / FRAME_BRAND_LOGO_LAYOUTS are DELIBERATELY
// excluded — the admin labels for those differ from the stored value by
// capitalisation only, which already reads as plain English, not jargon.
function labelList(values: readonly string[], labels: Readonly<Record<string, string>>): string {
  return values.map((v) => labels[v] ?? v).join(", ");
}
const FRAME_PAGE_TARGET_MODE_LABELS: Readonly<Record<string, string>> = {
  all: "Every page",
  first: "First page only",
  range: "A page range",
  list: "Specific pages",
};
const FRAME_TYPO_SIZE_LABELS: Readonly<Record<string, string>> = {
  s: "Small",
  m: "Medium",
  l: "Large",
  xl: "Extra large",
};
const FRAME_SIZE_LABELS: Readonly<Record<string, string>> = { s: "Small", m: "Medium", l: "Large" };
const FRAME_DISCLOSURE_MODE_LABELS: Readonly<Record<string, string>> = {
  full: "Always shown",
  hover: "Hover / focus trigger",
};
const FRAME_FOOTER_BLOCK_TYPE_LABELS: Readonly<Record<string, string>> = {
  about_paragraph: "Company details",
  link_row: "Link row",
  disclosure: "Disclosure",
  logo: "Logo",
  address: "Address",
  socials: "Social links",
  heading: "Heading",
  list: "List",
  divider: "Divider line",
};
const FRAME_FREE_TEXT_LIST_STYLE_LABELS: Readonly<Record<string, string>> = {
  unordered: "Bulleted",
  ordered: "Numbered",
  check: "Checklist",
};
const FRAME_FOOTER_LINKS_SOURCE_LABELS: Readonly<Record<string, string>> = {
  site: "The site's own logo",
  manual: "Manual (choose an image or paste a URL)",
};
const FRAME_FOOTER_LINK_ROW_SOURCE_LABELS: Readonly<Record<string, string>> = {
  site: "From site settings (legal links)",
  manual: "Manual list",
  picked: "From Pages (operator-picked)",
};
const FRAME_FREE_TEXT_SLOT_LABELS: Readonly<Record<string, string>> = {
  above_section: "Above the section",
  below_section: "Below the section",
  above_header: "Above the header",
  below_footer: "Below the footer",
};
const FRAME_CTA_SLOT_LABELS: Readonly<Record<string, string>> = {
  header_right: "Header (right)",
  under_header: "Under the header",
  section_bottom: "Bottom of the section",
  footer: "Footer",
};

// ---------------------------------------------------------------------------
// P8-6 Q8 — THE ENUM SEAM.
//
// Every closed vocabulary declared with `oneOf()` in FRAME_GROUP_SPECS above
// reaches the operator through exactly ONE sentence: the `case "enum"` arm of
// validateField, which used to end in `spec.values.join(", ")` — a raw dump of
// the STORED ids ("icon_on_track, under_header, brand_gradient"). Instead of
// rewriting ~26 call sites, that ONE arm now asks this ONE registry whether the
// vocabulary it was handed has operator words, and renders them when it does.
//
// Keyed by the vocabulary ARRAY ITSELF: `oneOf` stores the `as const` array by
// reference, so ONE row here covers EVERY field that reuses that vocabulary
// (FRAME_SIZES alone is 4 fields), and a future vocabulary becomes readable by
// adding one row — never by touching the message. Keying by array rather than
// by value is also what makes it SAFE: the same stored id means different
// things in different vocabularies ("full" is Full width on a progress bar and
// "site" is a different source for a logo than for legal links), so a global
// value->label table would mislabel; a per-vocabulary table cannot.
//
// NOT A GATE (§1): an unregistered vocabulary is NOT an error and never
// throws. `?? v` per value (labelList) and the `undefined` branch per
// vocabulary keep today's exact sentence for everything unlabelled — the
// stored value is the honest answer where no operator control names it.
//
// Registered ONLY where a REAL operator control was read, cited per row, and
// converged VERBATIM with it — kept as local data for the same PURE-module
// reason as the label maps above (several admin files import
// validateFrameConfig FROM here, so importing labels back from admin would
// invert the boundary). Vocabularies whose control differs from the stored
// value by CAPITALISATION only (FRAME_LOGO_ALIGNS / FRAME_PROGRESS_ALIGNS /
// FRAME_SLOT_ALIGNS -> Left/Center/Right) are DELIBERATELY absent, the same
// rule the label maps above already follow: that already reads as plain
// English in a sentence, and is not the jargon class.
const FRAME_PROGRESS_STYLE_LABELS: Readonly<Record<string, string>> = {
  // quotes-tabs/templates.ts PROGRESS_STYLE_LABELS (the one map its picker,
  // saved-template pill and apply-confirm sentences all read from).
  hidden: "No progress bar",
  bar: "Bar",
  dots: "Dots",
  numbered: "Numbered",
  percent: "Percent",
  icon_on_track: "Icon on track",
};
const FRAME_PROGRESS_ICON_LABELS: Readonly<Record<string, string>> = {
  // quotes-tabs/templates.ts frameSelect("Marker icon", "progress.icon", …).
  dot: "Plain dot",
  car: "Car",
  shield: "Shield",
  check: "Checkmark",
  star: "Star",
  site_logo: "This site's logo",
  custom: "My own image",
};
const FRAME_PROGRESS_POSITION_LABELS: Readonly<Record<string, string>> = {
  // quotes-tabs/templates.ts frameSelect("Position", "progress.position", …).
  top: "Top of page",
  under_header: "Under the header",
  above_unit: "Above the question unit",
  in_card: "Inside the card",
};
const FRAME_PROGRESS_WIDTH_LABELS: Readonly<Record<string, string>> = {
  // quotes-tabs/templates.ts segmentedControl("Width", "progress.width", …).
  content: "Content width",
  full: "Full width",
};
const FRAME_BACKGROUND_STYLE_LABELS: Readonly<Record<string, string>> = {
  // quotes-tabs/templates.ts frameSelect("Style", "background.style", …).
  flat: "Flat",
  brand: "Brand",
  brand_gradient: "Brand gradient",
};
const FRAME_LOGO_SOURCE_LABELS: Readonly<Record<string, string>> = {
  // quotes-tabs/templates.ts frameSelect("Logo source", "header.logo_source",
  // …). PARTIAL BY DESIGN: that control offers only site + cms_fallback, so
  // the third stored value ("manual") has no operator wording to converge with
  // and falls through labelList's `?? v` — already a plain English word.
  site: "Site logo (auto)",
  cms_fallback: "CMS fallback",
};

const FRAME_ENUM_LABELS: ReadonlyMap<readonly string[], Readonly<Record<string, string>>> = new Map<
  readonly string[],
  Readonly<Record<string, string>>
>([
  [FRAME_PROGRESS_STYLES, FRAME_PROGRESS_STYLE_LABELS],
  [FRAME_PROGRESS_ICONS, FRAME_PROGRESS_ICON_LABELS],
  [FRAME_PROGRESS_POSITIONS, FRAME_PROGRESS_POSITION_LABELS],
  [FRAME_PROGRESS_WIDTHS, FRAME_PROGRESS_WIDTH_LABELS],
  [FRAME_BACKGROUND_STYLES, FRAME_BACKGROUND_STYLE_LABELS],
  [FRAME_LOGO_SOURCES, FRAME_LOGO_SOURCE_LABELS],
  // FRAME_SIZES / FRAME_TYPO_SIZES: the s/m/l(/xl) maps already converged with
  // templates.ts above — registering them here is what makes the GENERIC arm
  // say what validateFrameTypography already says.
  [FRAME_SIZES, FRAME_SIZE_LABELS],
  [FRAME_TYPO_SIZES, FRAME_TYPO_SIZE_LABELS],
]);

// The one lookup. Unlabelled vocabulary -> today's exact `join(", ")`.
function frameEnumList(values: readonly string[]): string {
  const labels = FRAME_ENUM_LABELS.get(values);
  return labels === undefined ? values.join(", ") : labelList(values, labels);
}

// Shared page-target validator (10E/10F/10G).
function validateFramePageTarget(value: unknown, path: string, push: FramePush): void {
  if (!isRecord(value)) {
    push("error", path, "Page targeting must be a group of settings.");
    return;
  }
  if (!inEnum(value["mode"], FRAME_PAGE_TARGET_MODES)) {
    push("error", `${path}.mode`, `Page targeting must be one of: ${labelList(FRAME_PAGE_TARGET_MODES, FRAME_PAGE_TARGET_MODE_LABELS)}.`);
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
    push("error", `${path}.size`, `The text size must be one of: ${labelList(FRAME_TYPO_SIZES, FRAME_TYPO_SIZE_LABELS)}.`);
  }
  if (value["color"] !== undefined && !isFunnelTokenRole(value["color"])) {
    push("error", `${path}.color`, `The text colour must be a theme colour role: ${funnelTokenRoleLabelList()}.`);
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
      push("error", `${p}.mode`, `A disclosure entry mode must be one of: ${labelList(FRAME_DISCLOSURE_MODES, FRAME_DISCLOSURE_MODE_LABELS)}.`);
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
      push("error", `${p}.type`, `A footer block type must be one of: ${labelList(FRAME_FOOTER_BLOCK_TYPES, FRAME_FOOTER_BLOCK_TYPE_LABELS)}.`);
    }
    if (block["text"] !== undefined && typeof block["text"] !== "string") {
      push("error", `${p}.text`, "A footer block's text must be plain text.");
    }
    // R2 P3 (element J) SECURITY — the SAME STORE-time re-serialize-and-
    // OVERWRITE pattern validateFreeText uses above (frames.ts is the caller's
    // `raw` object graph; this mutation is what persists — see
    // lib/inline-sanitizer.ts's module header). about_paragraph/disclosure/
    // heading all share this one optional rich-text field.
    if (typeof block["html"] === "string") {
      block["html"] = sanitizeFrameInlineHtml(block["html"]);
    }
    if (block["level"] !== undefined && typeof block["level"] !== "number") {
      push("error", `${p}.level`, "A footer heading level must be a number.");
    }
    if (block["type"] === "list") {
      if (!Array.isArray(block["items"])) {
        push("error", `${p}.items`, "A list block needs a list of items.");
      } else {
        block["items"] = (block["items"] as unknown[]).map((it) =>
          typeof it === "string" ? sanitizeFrameInlineHtml(it) : it,
        );
      }
      if (block["list_style"] !== undefined && !inEnum(block["list_style"], FRAME_FREE_TEXT_LIST_STYLES)) {
        push("error", `${p}.list_style`, `A footer list style must be one of: ${labelList(FRAME_FREE_TEXT_LIST_STYLES, FRAME_FREE_TEXT_LIST_STYLE_LABELS)}.`);
      }
    }
    // "logo" type — site branding (default) or a manual media/URL override.
    // Reuses FRAME_FOOTER_LINKS_SOURCES's site|manual enum (see the interface
    // comment) and the SAME SAFE_HREF_RE gate every other footer href uses.
    if (block["logo_source"] !== undefined && !inEnum(block["logo_source"], FRAME_FOOTER_LINKS_SOURCES)) {
      push("error", `${p}.logo_source`, `A footer logo source must be one of: ${labelList(FRAME_FOOTER_LINKS_SOURCES, FRAME_FOOTER_LINKS_SOURCE_LABELS)}.`);
    }
    if (block["logo_media_id"] !== undefined && block["logo_media_id"] !== null && typeof block["logo_media_id"] !== "string") {
      push("error", `${p}.logo_media_id`, "A footer logo media reference must be plain text, or empty.");
    }
    if (block["logo_url"] !== undefined && (!isNonEmptyString(block["logo_url"]) || !SAFE_HREF_RE.test(String(block["logo_url"]).trim()))) {
      push("error", `${p}.logo_url`, "A footer logo URL needs a web address (https://…) or a page path (/…).");
    }
    if (block["logo_alt"] !== undefined && typeof block["logo_alt"] !== "string") {
      push("error", `${p}.logo_alt`, "A footer logo alt text must be plain text.");
    }
    // R2 P3 (element J) D2 — link_row's OWN wider enum (adds "picked"); every
    // OTHER links_source-shaped field (the top-level legacy footer.links_source,
    // logo_source above) intentionally still checks FRAME_FOOTER_LINKS_SOURCES
    // (site|manual only — "picked" has no meaning there).
    if (block["links_source"] !== undefined && !inEnum(block["links_source"], FRAME_FOOTER_LINK_ROW_SOURCES)) {
      push("error", `${p}.links_source`, `A footer link source must be one of: ${labelList(FRAME_FOOTER_LINK_ROW_SOURCES, FRAME_FOOTER_LINK_ROW_SOURCE_LABELS)}.`);
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
    // link_row, links_source:"picked" (D2) — the operator's picked page set.
    // `manual_url`, when present, is the ONE new operator-typed href this
    // adds; SAFE_HREF_RE-gated exactly like every other footer href (the
    // per-serving-site resolved href itself is built server-side from that
    // site's own slug, never operator text — leadgen/branding.ts, S3b).
    if (block["picks"] !== undefined) {
      if (!Array.isArray(block["picks"])) {
        push("error", `${p}.picks`, "Footer picked pages must be a list.");
      } else {
        (block["picks"] as unknown[]).forEach((pk, j) => {
          const pkp = `${p}.picks[${j}]`;
          if (!isRecord(pk) || !isNonEmptyString(pk["page_type"])) {
            push("error", `${pkp}.page_type`, "A picked page needs its page type.");
          }
          if (!isRecord(pk) || !isNonEmptyString(pk["label"])) {
            push("error", `${pkp}.label`, "A picked page needs a label.");
          }
          // R2 P3 FIX-FIRST (BLOCKER-2) — the OPTIONAL per-site-unique slug.
          // Optional on purpose: picks saved before this fix carry only
          // page_type and must keep validating (and resolving) unchanged.
          if (isRecord(pk) && pk["slug"] !== undefined && !isNonEmptyString(pk["slug"])) {
            push("error", `${pkp}.slug`, "A picked page's address must be plain text.");
          }
          if (
            isRecord(pk) &&
            pk["manual_url"] !== undefined &&
            (!isNonEmptyString(pk["manual_url"]) || !SAFE_HREF_RE.test(String(pk["manual_url"]).trim()))
          ) {
            push("error", `${pkp}.manual_url`, "A picked page's fallback URL needs a web address (https://…) or a page path (/…).");
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
      push("error", `${p}.slot`, `A free-text slot must be one of: ${labelList(FRAME_FREE_TEXT_SLOTS, FRAME_FREE_TEXT_SLOT_LABELS)}.`);
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
        // SECURITY (adversarial review MAJOR-1, Round-4 P5a fix): run the SAME
        // allowlist re-serializer that frame.ts uses at RENDER time here too,
        // at STORE time — and OVERWRITE the field with its output (a
        // deliberate, documented mutation of the caller's `raw` object). Every
        // caller of validateFrameConfig (frame-handlers.ts's PUT
        // /funnels/:id/frame handler, the money-path one) persists
        // JSON.stringify(raw) AFTER this function returns — since `b` here is
        // a reference into the SAME object graph `raw` points to, this
        // rewrite is exactly what ends up in D1: the authored payload never
        // persists, even if some future write path skipped render-time
        // sanitization entirely. See lib/inline-sanitizer.ts's module header
        // for the full corpus this closes.
        if (typeof b["html"] === "string") {
          b["html"] = sanitizeFrameInlineHtml(b["html"]);
        }
        if (b["type"] === "list") {
          if (!Array.isArray(b["items"])) {
            push("error", `${bp}.items`, "A list block needs a list of items.");
          } else {
            b["items"] = (b["items"] as unknown[]).map((it) =>
              typeof it === "string" ? sanitizeFrameInlineHtml(it) : it,
            );
          }
          if (b["style"] !== undefined && !inEnum(b["style"], FRAME_FREE_TEXT_LIST_STYLES)) {
            push("error", `${bp}.style`, `A list style must be one of: ${labelList(FRAME_FREE_TEXT_LIST_STYLES, FRAME_FREE_TEXT_LIST_STYLE_LABELS)}.`);
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
        push("error", `${p}.size`, `A brand-logo size must be one of: ${labelList(FRAME_SIZES, FRAME_SIZE_LABELS)}.`);
      }
    });
  }
  if (value["slot"] !== undefined && !inEnum(value["slot"], FRAME_FREE_TEXT_SLOTS)) {
    push("error", `${base}.slot`, `The brand-logos slot must be one of: ${labelList(FRAME_FREE_TEXT_SLOTS, FRAME_FREE_TEXT_SLOT_LABELS)}.`);
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
      push("error", `${p}.slot`, `A CTA slot must be one of: ${labelList(FRAME_CTA_SLOTS, FRAME_CTA_SLOT_LABELS)}.`);
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
      push("error", `${p}.slot`, `A trust-row slot must be one of: ${labelList(FRAME_FREE_TEXT_SLOTS, FRAME_FREE_TEXT_SLOT_LABELS)}.`);
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
      push("error", `${p}.slot`, `An image slot must be one of: ${labelList(FRAME_FREE_TEXT_SLOTS, FRAME_FREE_TEXT_SLOT_LABELS)}.`);
    }
    if (item["size"] !== undefined && !inEnum(item["size"], FRAME_SIZES)) {
      push("error", `${p}.size`, `An image size must be one of: ${labelList(FRAME_SIZES, FRAME_SIZE_LABELS)}.`);
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
    // v3.1 §10.1 — "A funnel variant overrides it for A/B via
    // leadgen_funnel_variants.frame_overrides_json.theme_id" (§11.1 lists the
    // column as holding "A/B frame + theme_id overrides"). `theme_id` is
    // therefore a LEGITIMATE top-level key of a frame-overrides document, not
    // an unknown frame group. theme.ts owns its MEANING (winningThemeId reads
    // frame_overrides_json["theme_id"] as the per-variant theme REFERENCE,
    // beating the funnel's theme_json) and the admin handler layer owns the
    // KV existence check (this module reaches no storage) — so all this pure
    // validator pins is the SHAPE: a non-empty theme id string.
    //
    // P8-1 F8 (product bug — two sides of one feature on different
    // contracts): the WRITER (PUT /variants/:id) destructures theme_id out
    // before calling this function and validates it separately, so a stored
    // `{"theme_id":"thm_…"}` is written happily — but three READERS hand the
    // key straight through to this loop: the activation preflight
    // (computeVariantV25Problems), the draft-overrides preview
    // (draft_frame_overrides) and the serve resolver's overrides validation.
    // The first two turned the operator's own saved value into the publish
    // blocker "'theme_id' isn't a recognised frame setting"; the third got
    // `config === null` and SILENTLY dropped the entire overrides patch at
    // render time. Recognising the key HERE converges all four call sites on
    // the single schema the contract says the column holds. Narrowing only:
    // every OTHER unrecognised key still falls through to the rejection
    // below, and a malformed theme_id is still reported.
    if (key === "theme_id") {
      if (!isNonEmptyString(value)) {
        push("error", "frame.theme_id", "The theme reference must be a theme id.");
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
            `Each ${spec.itemLabel} must be an entry with ${fieldNames.map(humanize).join(" + ")}.`,
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
        // P8-6 Q8: the ONE place every oneOf() vocabulary is spoken aloud.
        push("error", path, `The ${label} setting must be one of: ${frameEnumList(spec.values)}.`);
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
          `The ${label} setting must be a theme colour role: ${funnelTokenRoleLabelList()}.`,
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

// ---------------------------------------------------------------------------
// R2 P8 M3 / R2-1 — computeTemplateApply: what "Apply to funnel…" must DO.
//
// MEASURED BEFORE (test/leadgen-p8-m3-apply-template.test.ts, the fail-before
// leg): applying a saved template used to write ONLY the
// `leadgen_funnels.frame_template_id` pointer. effectiveFrame composes
//   FRAME_TEMPLATES[family].defaults ⊕ savedTemplate ⊕ funnel.frame_config_json
// so the funnel column shadows the template on EVERY LEAF IT HOLDS, and a
// pointer-only apply can only ever move the leaves it does NOT hold. On the
// fail-before fixture — a column carrying the whole composition — the apply
// moved exactly ONE leaf of the served page: `template`, the identity string no
// CSS rule is keyed on. The operator saw nothing change.
//
// R2 P8-4 FIX ROUND F10 — HOW a column gets that full, corrected. This note used
// to read "the Quote Builder PUTs its WHOLE hydrated frame back on every Save
// (quotes-tabs/funnel.ts:1675 over hydrationBase()), so the funnel column is a
// COMPLETE config the moment a funnel has ever been saved". DRIVEN, that is
// false — and it contradicted the F9 note below that the current prune rule
// rests on. A Save PUTs `workingFrame`, which is
// `deepClone(frameState.frame_config || {})` (quotes-tabs/funnel.ts:1809 — the
// STORED column) plus the paths this session touched: a real Save was observed
// PUTting exactly `{"version":1,"template":"centered","header":{"logo_align":
// "left"}}`, the stored column plus the one touched path. `hydrationBase()`
// feeds clientEffective(), which POPULATES control values; it is never the
// payload. So the column grows leaf by leaf with what the operator touches —
// which is precisely why the F9 invariant below must tell an operator-authored
// leaf apart from an echo instead of pruning by agreement-with-the-base.
//
// The semantics chosen here are MATERIALISE, not "reorder the merge":
//   * the template's authored leaves are WRITTEN INTO the funnel's own
//     frame_config_json, so the visitor's page paints them AND the operator
//     can then edit them in the builder (a template kept as a shadowing base
//     layer would be re-shadowed by the very next Save — the failure mode
//     quotes-tabs/funnel.ts:1834 already documents);
//   * what is stored is what is served — no invisible layer;
//   * leaves the template does NOT author keep the operator's value, so
//     applying a footer-only template cannot silently wipe a header;
//   * a template can ADD or CHANGE, never BLANK OUT: an empty/null/[] leaf in
//     the template never erases copy, media or a list the operator authored.
//     This is the same register §4.3's computeTemplateSwitch already uses
//     ("OPERATOR CONTENT is PRESERVED VERBATIM — copy, media, legal links…"),
//     applied to the saved-template path: a complete saved row carries a null
//     `header.tagline` simply because nobody typed one INTO THE TEMPLATE, and
//     that silence must not delete the tagline the funnel already shows. A
//     template that genuinely carries content (the P3 footer templates, trust
//     logos, benefit items, disclosure copy) still applies it, because those
//     leaves are non-blank;
//   * every leaf this replaces is RETURNED (changes + replaced_customisations
//     + operator-language confirmations) so the confirm dialog can state the
//     truth before the write instead of enumerating fixed promises.
// The `frame_template_id` pointer still gets written by the caller: it is the
// in-use guard's referrer, the board's Template chip identity and the base
// layer for anything the funnel never authored.
//
// R2 P8 FIX ROUND F4 — the materialise above, written as "every template leaf
// into the funnel column", caused TWO defects of its own (review-p8-4 F-1/F-2),
// and both have ONE cause: it stored leaves the funnel's own template ALREADY
// supplies, turning the funnel layer into a full shadow of its own base.
//   F-1  the confirm dialog counted `replaced_customisations` from "the funnel
//        column carries this path", so from the SECOND apply on it announced
//        every leaf apply #1 had written as a setting THE OPERATOR customised:
//        driven on a pristine funnel (frame_config {}), "9 settings you had
//        customised are replaced by this template." with zero operator edits,
//        ever. (This branch's own fixture measured 24, then 28/28.)
//   F-2  a variant's `frame_template_id` (the A/B-templates arm) resolves as
//        effectiveFrame's BASE layer, UNDER the funnel column — so a funnel
//        whose column echoed its template shadowed the arm's own template on
//        every leaf, and the two arms rendered identically forever.
// THE RULE, one line, fixing both: the funnel's frame_config_json holds what
// DIFFERS from its template, never an echo of it. So this function
//   (a) MATERIALISES as before, then PRUNES every leaf the applied template's
//       own base composition already gives (pruneEchoedLeaves) — the served
//       composition is leaf-identical either way (the pruned leaf is re-supplied
//       by the very base it was copied from), the column stops shadowing, and
//       an arm pointing at another template renders THAT template;
//   (b) counts as a CUSTOMISATION only a leaf the OPERATOR authored — see the
//       F9 note below for how that is decided, and for the claim this line used
//       to make and could not keep.
//
// R2 P8-4 FIX ROUND F9 — the prune above DELETED OPERATOR-AUTHORED VALUES
// (review-p8-4b F-B, driven): with the funnel column at
// `{"version":1,"template":"centered","header":{"logo_align":"left"}}` — the
// operator's own pick against a base that says "center" — applying a template
// whose base ALSO says "left" removed the leaf (column became
// `{"version":1,"template":"header-footer"}`) with `replaced_customisations:[]`
// and no `changes` entry; applying a THIRD template then flipped the logo back
// to "center" with `replaced_customisations:[]` and not one sentence naming it.
// F4's own mitigation claim — "the change itself is still announced by name in
// `changes` and in the sentences below" — WAS FALSE and is deleted here:
// `changes` is a payload field the dialog does not paint, and `confirmations`
// narrates ~8 leaf shapes, none of them the logo. So the operator's value was
// destroyed with no signal on either apply.
//
// THE INVARIANT, and how the two halves below keep it:
//   A VALUE THE OPERATOR CHOSE IS NEVER SILENTLY DISCARDED — it is either
//   PRESERVED in the column, or NAMED in the warning before the write.
//   * PRESERVED: the prune now keeps an authored leaf the apply does not move,
//     even when the incoming template's base happens to agree with it. Only
//     leaves this apply MATERIALISED (or an echo the column already carried)
//     are dropped, so the served page is still leaf-identical either way and
//     F-2 still holds — the column carries no shadow of its own template.
//   * NAMED: an authored leaf the template does overrule is in `changes` AND in
//     `replaced_customisations`, which is what the honesty sentence counts.
// WHICH LEAVES ARE THE OPERATOR'S (`authoredLeaves`), and why it is two-branch:
//   * A column this code has touched can only ever hold the operator's own
//     leaves: an apply writes NO leaf of its own (every materialised leaf is
//     re-supplied by the base and pruned), and the product's only other writer
//     is the Quote Builder, which boots `workingFrame` from the STORED column
//     (quotes-tabs/funnel.ts:1809) and adds exactly the dotted path a control
//     wrote. So for such a column, PRESENCE IS AUTHORSHIP — which is the bit
//     the value test could not recover once a preserved leaf coincided with the
//     new base (the third step of the drive above).
//   * A WHOLESALE column — one that carries EVERY leaf of its own base, the
//     shape a client PUTting a whole hydrated frame produces — cannot attribute
//     its leaves to anybody, so there the F4 value test still decides: authored
//     means "moves the composition away from its own base". This is what keeps
//     F-1 fixed for that shape (28 echoed leaves must not be announced as 28
//     customisations), and the accepted blind spot is unchanged and now
//     STATED PLAINLY: on a wholesale column, an operator who authored exactly
//     the base's own value is indistinguishable from the echo, and that leaf is
//     not counted. It is not silently destroyed either — a leaf equal to the
//     base changes nothing about the served page, and the moment a template
//     moves it, the move itself is in `changes`.
// Two consequences of (a), stated rather than discovered:
//   * "silence never erases" still protects OPERATOR content (their leaves stay
//     in the column and a blank template leaf never overwrites them), but a leaf
//     a PREVIOUS template wrote is no longer inherited by the next one — that
//     inheritance existed only because the previous apply had copied it into the
//     column. An applied template is now the clean slate its name implies for
//     everything the operator did not author.
//   * CLEARING the pointer ({template_id:null}) drops more than it used to: the
//     column no longer carries a copy of the template's leaves, so the funnel
//     falls back to frame_config_json.template's family defaults plus its own
//     authored leaves. That is what the composition always meant; `changes`
//     already reports it leaf by leaf before the write.
// ---------------------------------------------------------------------------

// One changed leaf of the SERVED composition (effectiveFrame before → after).
// `path` is dotted from the frame root ("section_slot.card"); an array leaf is
// compared and reported WHOLE, mirroring mergeInto's array rule.
export interface FrameLeafChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface TemplateApplyResult {
  // What to persist into leadgen_funnels.frame_config_json.
  merged: StoredFrameConfig;
  // Every leaf of the served composition this apply moves.
  changes: FrameLeafChange[];
  // The subset the FUNNEL ITSELF had authored to a different value — the
  // operator's own choices this template replaces.
  replaced_customisations: string[];
  // Operator-language sentences, derived from `changes` (never a fixed list).
  confirmations: string[];
}

// Flatten to leaf paths. Objects recurse; arrays are leaves (replaced whole).
function frameLeaves(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      frameLeaves(child, prefix === "" ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  out.set(prefix, value);
}

function sameLeaf(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// "The template says nothing here": no value, empty copy, or an empty list.
// `false` and `0` are REAL values (a template must be able to switch a region
// off), so only absence/emptiness counts as silence.
function blankLeaf(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

// mergeInto, plus the one rule above: a blank template leaf never overwrites a
// value the funnel already has. Objects still recurse (a template that speaks
// only about footer.blocks leaves header.* alone either way).
function mergeTemplateInto(base: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isRecord(value)) {
      const current = base[key];
      if (isRecord(current)) mergeTemplateInto(current, value);
      else base[key] = cloneJson(value);
      continue;
    }
    if (blankLeaf(value) && !blankLeaf(base[key])) continue; // silence never erases
    base[key] = Array.isArray(value) ? cloneJson(value) : value;
  }
}

// R2 P8 FIX ROUND F4 (F-1/F-2, the write half) — drop every leaf whose value
// the BASE composition already gives, so the funnel column stores its
// DIFFERENCES from its template and nothing else. Composition-safe by
// construction: a leaf is removed only when the base holds the SAME value at
// the SAME path, so effectiveFrame(pruned ⊕ base) === effectiveFrame(merged ⊕
// base) leaf for leaf (proven end to end in the apply test's PASS-AFTER leg,
// which reads every template leaf back out of the SERVED frame). Root
// `template`/`version` are funnel-level identity, not composition leaves
// (effectiveFrame strips both from this layer), so they stay.
//
// R2 P8-4 FIX ROUND F9 (F-B) — `keep` is the operator's veto. A leaf the
// operator authored and this apply does NOT move is kept even though the base
// agrees with it, so the column never loses the record of a choice somebody
// made. Still composition-safe for the same reason in reverse: the kept leaf
// holds exactly the value the base would have supplied, so the served page is
// leaf-identical, and it is one leaf, not a shadow of the whole template.
function pruneEchoedLeaves(
  node: Record<string, unknown>,
  prefix: string,
  baseLeaves: Map<string, unknown>,
  keep: (path: string, value: unknown) => boolean,
): void {
  for (const key of Object.keys(node)) {
    if (prefix === "" && (key === "template" || key === "version")) continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const value = node[key];
    if (isRecord(value)) {
      pruneEchoedLeaves(value, path, baseLeaves, keep);
      if (Object.keys(value).length === 0) delete node[key];
      continue;
    }
    if (keep(path, value)) continue;
    if (baseLeaves.has(path) && sameLeaf(baseLeaves.get(path), value)) delete node[key];
  }
}

// The leaves of `stored` the OPERATOR authored — the F9 two-branch rule the
// header note states. A `null` return would be indistinguishable from "nothing
// authored", so the two branches are both explicit sets.
function authoredLeaves(
  storedLeaves: Map<string, unknown>,
  beforeBaseLeaves: Map<string, unknown>,
): Map<string, unknown> {
  // WHOLESALE = the column carries every leaf its own base gives. Nothing in
  // this product writes that (an apply writes no leaf; the builder writes the
  // column plus the paths a control touched) — it is the shape a client PUTting
  // a whole hydrated frame produces, and there no leaf is attributable, so the
  // F4 value test decides.
  let wholesale = beforeBaseLeaves.size > 0;
  for (const path of beforeBaseLeaves.keys()) {
    if (!storedLeaves.has(path)) {
      wholesale = false;
      break;
    }
  }
  const out = new Map<string, unknown>();
  for (const [path, value] of storedLeaves) {
    // Funnel-level identity, never a customisation: `template` is the family
    // the apply is changing on purpose and `version` is the schema stamp.
    if (path === "template" || path === "version") continue;
    if (wholesale && sameLeaf(value, beforeBaseLeaves.get(path))) continue;
    out.set(path, value);
  }
  return out;
}

const PROGRESS_STYLE_WORDS: Record<string, string> = {
  hidden: "hidden",
  bar: "a bar",
  dots: "dots",
  numbered: "numbered steps",
  percent: "a percentage",
  icon_on_track: "an icon on the track",
};

// R2 P8 FIX ROUND F4 (F-8) — the apply named 4 of its 9 changes and left the
// rest to the (then false) count. These three maps close the gap for the leaves
// that move the page's SHAPE: which regions exist, where they sit, what the
// question unit looks like. They speak the words the operator's own controls
// use — progress positions are quotes-tabs/templates.ts's own Position select
// ("Top of page" / "Under the header" / "Above the question unit" / "Inside the
// card"), background roles are the palette's own role names (humanize).
//
// DELIBERATELY NOT NARRATED, and why: every other leaf (sizes, thicknesses,
// widths, mobile modes, transitions, copy, media ids, list contents) is a
// DIMENSION or a piece of CONTENT, not a change of shape. One sentence per leaf
// would bury the shape changes under a page of prose for an operator who is
// about to press Apply — and none of them is lost: every leaf, narrated or not,
// rides `changes` (path/from/to) and is counted by the customisation line when
// it is the operator's own. Silence here is never silence in the payload.
const PROGRESS_POSITION_WORDS: Record<string, string> = {
  top: "to the top of the page",
  under_header: "under the header",
  above_unit: "above the question unit",
  in_card: "inside the card",
};
const BACK_POSITION_WORDS: Record<string, string> = {
  under_header_left: "under the header",
  in_card: "inside the card",
  below_card: "below the card",
  footer: "into the footer",
};

// enabled-flag lines, in the order the owner reads the page.
const APPLY_REGION_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["header.enabled", "header"],
  ["disclosure.enabled", "disclosure"],
  ["trust_strip.enabled", "trust strip"],
  ["benefit_bar.enabled", "benefit bar"],
  ["footer.enabled", "footer"],
];

export function computeTemplateApply(
  currentStored: StoredFrameConfig | null,
  templateDefaults: EffectiveFrameConfig | null,
  currentTemplateDefaults?: EffectiveFrameConfig | null,
): TemplateApplyResult {
  const before = effectiveFrame(currentStored, null, null, currentTemplateDefaults ?? null).frame;
  // What this funnel would show with NO config of its own — its CURRENT
  // template's base. On a WHOLESALE column (F9) this is the only signal left
  // for what the operator did NOT author; on every column the product itself
  // writes, presence in the column is the signal.
  const beforeBase = effectiveFrame(null, null, null, currentTemplateDefaults ?? null).frame;

  // The operator's own leaves, decided BEFORE anything is materialised over
  // them (F9): they drive both the prune's veto and the customisation count.
  const storedLeaves = new Map<string, unknown>();
  frameLeaves(currentStored ?? {}, "", storedLeaves);
  const beforeBaseLeaves = new Map<string, unknown>();
  frameLeaves(beforeBase, "", beforeBaseLeaves);
  const authored = authoredLeaves(storedLeaves, beforeBaseLeaves);

  // Materialise: the template's own authored leaves over the funnel's config.
  // A null template (clearing the pointer) materialises nothing — the funnel
  // keeps exactly what it has, and `changes` then reports what LOSING the
  // pointer's base layer does to the served page.
  const merged = cloneJson(currentStored ?? {}) as Record<string, unknown>;
  if (templateDefaults !== null) {
    mergeTemplateInto(merged, templateDefaults as unknown as Record<string, unknown>);
    merged["version"] = 1;
    // …then keep only what DIFFERS from the applied template's own base (F-1/
    // F-2), PLUS the operator's own untouched leaves (F9). Same served page, no
    // shadow layer over a variant's own template.
    const afterBaseLeaves = new Map<string, unknown>();
    frameLeaves(effectiveFrame(null, null, null, templateDefaults).frame, "", afterBaseLeaves);
    pruneEchoedLeaves(merged, "", afterBaseLeaves, (path, value) => authored.has(path) && sameLeaf(authored.get(path), value));
  }
  const mergedConfig = merged as StoredFrameConfig;

  const after = effectiveFrame(mergedConfig, null, null, templateDefaults ?? null).frame;

  const beforeLeaves = new Map<string, unknown>();
  const afterLeaves = new Map<string, unknown>();
  frameLeaves(before, "", beforeLeaves);
  frameLeaves(after, "", afterLeaves);

  const changes: FrameLeafChange[] = [];
  const replaced: string[] = [];
  for (const [path, to] of afterLeaves) {
    const from = beforeLeaves.get(path);
    if (sameLeaf(from, to)) continue;
    changes.push({ path, from: from ?? null, to });
    // The OPERATOR authored this leaf (authoredLeaves above), and this template
    // moves it: that is exactly what the honesty sentence must count. A leaf a
    // whole-frame PUT merely echoed from the base is not attributable to the
    // operator and is not counted — the F-1 cry-wolf F4 removed.
    if (authored.has(path)) replaced.push(path);
  }
  // A leaf the composition LOSES entirely (an optional group the template
  // doesn't carry) is a change too.
  for (const [path, from] of beforeLeaves) {
    if (afterLeaves.has(path)) continue;
    changes.push({ path, from, to: null });
  }

  const changed = new Map(changes.map((c) => [c.path, c]));
  const confirmations: string[] = [];

  const card = changed.get("section_slot.card");
  if (card !== undefined) {
    const word = (v: unknown): string => (v === "card" ? "a card" : "a bare layout");
    confirmations.push(`The question unit changes from ${word(card.from)} to ${word(card.to)}.`);
  }
  const style = changed.get("progress.style");
  if (style !== undefined) {
    const word = (v: unknown): string => PROGRESS_STYLE_WORDS[String(v)] ?? String(v);
    confirmations.push(`Progress changes from ${word(style.from)} to ${word(style.to)}.`);
  }
  // F-8: the four shape leaves the register used to leave to the count alone.
  const progressPosition = changed.get("progress.position");
  if (progressPosition !== undefined) {
    const where = PROGRESS_POSITION_WORDS[String(progressPosition.to)];
    if (where !== undefined) confirmations.push(`Progress moves ${where}.`);
  }
  const backPosition = changed.get("back.position");
  if (backPosition !== undefined) {
    const where = BACK_POSITION_WORDS[String(backPosition.to)];
    if (where !== undefined) confirmations.push(`The back link moves ${where}.`);
  }
  for (const [path, label] of APPLY_REGION_WORDS) {
    const flag = changed.get(path);
    if (flag === undefined) continue;
    confirmations.push(flag.to === true ? `A ${label} will be added.` : `The ${label} will be removed.`);
  }
  const sticky = changed.get("header.sticky");
  if (sticky !== undefined) {
    confirmations.push(
      sticky.to === true
        ? `The header stays on screen as the visitor scrolls.`
        : `The header scrolls away with the page.`,
    );
  }
  const bg = changed.get("background.style");
  if (bg !== undefined) confirmations.push(`The page background changes from ${humanize(String(bg.from))} to ${humanize(String(bg.to))}.`);
  const bgRole = changed.get("background.role");
  if (bgRole !== undefined) confirmations.push(`The page background colour becomes ${humanize(String(bgRole.to))}.`);

  // The honesty line I1 requires: an operator who customised a leaf is TOLD
  // it is being replaced. Counted from the real diff, never a fixed promise.
  if (replaced.length === 1) {
    confirmations.push(`1 setting you had customised is replaced by this template.`);
  } else if (replaced.length > 1) {
    confirmations.push(`${replaced.length} settings you had customised are replaced by this template.`);
  }
  if (changes.length === 0) {
    confirmations.push(`This template matches what the funnel already shows — nothing on the page changes.`);
  }

  return { merged: mergedConfig, changes, replaced_customisations: replaced, confirmations };
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
