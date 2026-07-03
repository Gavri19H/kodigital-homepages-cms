// Measured values derived from tokens.ts PROSE fields (drift register +
// `measured` metadata groups) — design contract §30.1/§31.0 + register DEV-13.
//
// WHY THIS MODULE EXISTS. tokens.ts is the authoritative token contract, but
// two classes of measured values live there as PROSE, not CSS-clean fields:
//   1. the 2026-07-03 top-page DRIFT register (`measuredDriftRegister2026_07_03`)
//      — the conductor's DEV-13 decision is that the LIVE (new) value WINS,
//      while the §30.1 baseline direct fields stay untouched;
//   2. `measured` metadata sub-objects (disclosure panel, section divider,
//      heading lg-variant + number badge, button-group grids, footer
//      responsive details) whose values are recorded inside strings.
// The CSS mapper (tokens-to-css.ts) rightly skips metadata, so this module is
// the SINGLE place where prose-recorded measurements become structured CSS
// values. Every entry carries:
//   * `source`   — the tokens.ts path the value was read from, and
//   * `evidence` — literal substrings that MUST appear in that prose field.
// A unit test (listicles-measured-values.test.ts) walks every entry and
// asserts the evidence substrings against the live tokens object, so a value
// here can never silently drift from the measurement it claims to encode.
// NO value in this module is invented; each is a transcription (or arithmetic
// noted inline) of a tokens.ts measurement.

import { defaultListicleLayoutTokens } from "./tokens";

const T = defaultListicleLayoutTokens;

export interface DerivedValue {
  /** tokens.ts path (dot notation, for humans + the conformance test) */
  source: string;
  /** substrings that must appear in the source prose (conformance test) */
  evidence: ReadonlyArray<string>;
  /** structured CSS-clean values transcribed from the prose */
  values: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// 1. Top-page drift overrides (DEV-13: the MEASURED live value wins).
//    Keys mirror tokens.measuredDriftRegister2026_07_03 exactly — the
//    conformance test asserts SET EQUALITY between the register keys and
//    these override keys, so a new register entry cannot be silently ignored.
// ---------------------------------------------------------------------------

export const DRIFT_OVERRIDES_2026_07_03: Readonly<Record<string, DerivedValue>> = {
  pageFontFamily: {
    source: "measuredDriftRegister2026_07_03.pageFontFamily",
    evidence: ["Inter", "Arial"],
    // Live page loads Inter via next/font with an Arial-metric-adjusted
    // fallback; we declare Inter first and keep the baseline Arial stack as
    // the fallback (no external font fetch — see Phase-6 report).
    values: { fontFamily: "Inter, Arial, Helvetica, sans-serif" },
  },
  headerBackground: {
    source: "measuredDriftRegister2026_07_03.headerBackground",
    evidence: ["#e0072b"],
    values: { backgroundColor: "#e0072b" },
  },
  headerBorderBottom: {
    source: "measuredDriftRegister2026_07_03.headerBorderBottom",
    evidence: ["none"],
    values: { borderBottomWidth: "0px", borderBottomColor: "transparent" },
  },
  headerPaddingX: {
    source: "measuredDriftRegister2026_07_03.headerPaddingX",
    evidence: ["16px"],
    values: { paddingX: "16px" },
  },
  logoSlot: {
    source: "measuredDriftRegister2026_07_03.logoSlot",
    evidence: ["232.7x40", "h-10 w-auto"],
    // h-10 w-auto → fixed 40px height, intrinsic-ratio width (232.7px on the
    // reference asset). Width stays auto so ANY host logo keeps its ratio —
    // the logo is the ONLY per-host brand swap (§30.3).
    values: { height: "40px", width: "auto" },
  },
  disclosureTriggerFontSize: {
    source: "measuredDriftRegister2026_07_03.disclosureTriggerFontSize",
    evidence: ["12px", "14px", "1024"],
    values: { fontSize: "12px", fontSizeLg: "14px" },
  },
  headline: {
    source: "measuredDriftRegister2026_07_03.headline",
    evidence: ["36px/40px", "+4px py", "w700", "max-w-none", "m0"],
    // Two h2 lines, 36px/40px + 4px padding-y (48px line pitch), weight 700
    // via <strong>, letter-spacing normal, no max-width, margins 0.
    values: {
      fontSize: "36px",
      lineHeight: "40px",
      paddingY: "4px",
      fontWeight: "700",
      letterSpacing: "normal",
      maxWidth: "none",
      margin: "0px",
    },
  },
  byline: {
    source: "measuredDriftRegister2026_07_03.byline",
    evidence: ["30px", "12px/18px", "w600", "#4b5563"],
    values: {
      avatarSize: "30px",
      fontSize: "12px",
      lineHeight: "18px",
      fontWeight: "600",
      color: "#4b5563",
    },
  },
  hero: {
    source: "measuredDriftRegister2026_07_03.hero",
    evidence: ["radius 8px", "margins 0", "16px visual gaps"],
    // Radius 8px; the hero img itself carries no margins — the 16px visual
    // gap below is produced structurally: 10px wrapper margin + the intro
    // paragraph's 6px top padding (bodyParagraph drift) = 16px visual.
    values: { borderRadius: "8px", margin: "0px", wrapperMarginBottom: "10px" },
  },
  bodyParagraph: {
    source: "measuredDriftRegister2026_07_03.bodyParagraph",
    evidence: ["18px/30px", "#333333", "#2c2c2c", "6px paddings"],
    values: {
      fontSize: "18px",
      lineHeight: "30px",
      introColor: "#333333",
      sectionColor: "#2c2c2c",
      paddingY: "6px",
      margin: "0px",
    },
  },
};

// ---------------------------------------------------------------------------
// 2. §31.0 measured groups recorded as prose inside tokens.*.measured
// ---------------------------------------------------------------------------

// Disclosure dropdown panel (tokens.disclosureInteraction.measured) — the
// CSS-clean panel fields are read DIRECTLY off the tokens object below;
// the two prose-recorded facts are transcribed here with evidence.
export const DISCLOSURE_PANEL: DerivedValue = {
  source: "disclosureInteraction.measured.panelPosition",
  evidence: ["below the trigger", "8px offset", "right-aligned"],
  values: {
    position: "absolute",
    topOffset: "8px", // "top-full + 8px offset"
    right: "0",
  },
};

// Direct CSS-clean panel fields (typed reads, no prose parsing needed).
export const DISCLOSURE_PANEL_STYLE = {
  width: T.disclosureInteraction.measured.panelWidth,
  backgroundColor: T.disclosureInteraction.measured.panelBackgroundColor,
  color: T.disclosureInteraction.measured.panelTextColor,
  fontSize: T.disclosureInteraction.measured.panelFontSize,
  lineHeight: T.disclosureInteraction.measured.panelLineHeight,
  padding: T.disclosureInteraction.measured.panelPadding,
  borderRadius: T.disclosureInteraction.measured.panelBorderRadius,
  // "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1) (shadow-lg)"
  // → strip the trailing "(shadow-lg)" annotation.
  boxShadow: T.disclosureInteraction.measured.panelBoxShadow.replace(/\s*\(shadow-lg\)\s*$/, ""),
} as const;

// Section divider (tokens.sectionWrapper.measured) — the O3 fix: the
// inter-section rhythm lives on a REAL <hr> element, margins on the hr.
export const SECTION_DIVIDER: DerivedValue = {
  source: "sectionWrapper.measured",
  evidence: ["32px", "20px", "3px", "#e5e7eb"],
  values: {
    marginTop: T.sectionWrapper.measured.separatorMarginTop,
    marginBottom: T.sectionWrapper.measured.separatorMarginBottom,
    // "3px (1.5px top + 1.5px bottom border)" → rendered 3px band.
    height: "3px",
    color: T.sectionWrapper.measured.separatorColor,
  },
};

// Section-heading wrapper rhythm (tokens.sectionHeading.measured.wrapper):
// "div 'pt-1 mb-2 …' → 4px above / 8px below the heading; hover: underline +
// #374151".
export const SECTION_HEADING_WRAPPER: DerivedValue = {
  source: "sectionHeading.measured.wrapper",
  evidence: ["4px above", "8px below", "#374151"],
  values: { paddingTop: "4px", marginBottom: "8px", hoverColor: "#374151" },
};

// Section-heading ≥1024px stylesheet variant (tokens.sectionHeading.measured
// .lgVariant): "27.2px/40.8px at >=1024px".
export const SECTION_HEADING_LG: DerivedValue = {
  source: "sectionHeading.measured.lgVariant",
  evidence: ["27.2px/40.8px", "1024"],
  values: { fontSize: "27.2px", lineHeight: "40.8px" },
};

// Numbered heading badge (tokens.sectionHeading.measured.numberBadge):
// "bg #d1d5db (bg-gray-300), 6px padding-x, border-radius 8px, inline-flex,
// 6px margin-right, own line-height 24.6px (<1024px) / 35.8px (>=1024px)".
export const HEADING_NUMBER_BADGE: DerivedValue = {
  source: "sectionHeading.measured.numberBadge",
  evidence: ["#d1d5db", "6px padding-x", "border-radius 8px", "inline-flex", "6px margin-right", "24.6px", "35.8px"],
  values: {
    backgroundColor: "#d1d5db",
    paddingX: "6px",
    borderRadius: "8px",
    display: "inline-flex",
    marginRight: "6px",
    lineHeight: "24.6px",
    lineHeightLg: "35.8px",
  },
};

// Section image gaps (tokens.sectionImage.measured): 8px below the heading
// (already provided by the heading wrapper's 8px margin-bottom) and a 16px
// visual gap to the following paragraph — produced structurally as 10px
// wrapper margin + the paragraph's 6px top padding (bodyParagraph drift).
export const SECTION_IMAGE_GAPS: DerivedValue = {
  source: "sectionImage.measured",
  evidence: ["8px", "16px"],
  values: { wrapperMarginBottom: "10px" },
};

// Choice-button-group grid columns (tokens.choiceButtonGroup.measured):
// 6- and 3-button groups: grid-cols-1 / lg:grid-cols-3; 2- and 4-button
// groups: grid-cols-2 at every measured viewport.
export const BUTTON_GROUP_GRID: DerivedValue = {
  source: "choiceButtonGroup.measured",
  evidence: ["grid-cols-1 lg:grid-cols-3", "grid-cols-2 lg:grid-cols-2"],
  values: {
    defaultColumns: "1",
    defaultColumnsLg: "3",
    evenColumns: "2", // 2- and 4-button groups
  },
};

// Group follow-up CTA (tokens.choiceButtonGroup.measured.followUpCta): a
// full-width button-styled <a> after each group with 8px margins (my-2).
export const GROUP_FOLLOWUP_CTA: DerivedValue = {
  source: "choiceButtonGroup.measured.followUpCta",
  evidence: ["full-width", "my-2", "8px above/below"],
  values: { marginY: "8px" },
};

// Legal band (tokens.legalDisclosureBlock.measured.band): full-width white
// 'pt-4 pb-4 flex justify-center' band → 16px padding-y, centered content.
export const LEGAL_BAND: DerivedValue = {
  source: "legalDisclosureBlock.measured.band",
  evidence: ["pt-4 pb-4", "justify-center", "16px padding-y"],
  values: { paddingY: "16px", display: "flex", justifyContent: "center" },
};

// Footer responsive facts (tokens.footer.measured.*):
export const FOOTER_MEASURED: DerivedValue = {
  source: "footer.measured",
  evidence: ["max-w-screen-xl", "#9ca3af", "justify", "pb-[69px]", "lg:pb-10", "me-6", "mb-6"],
  values: {
    innerMaxWidth: "1280px", // max-w-screen-xl
    // innerContainer: "p-4 md:py-8" → px 16, py 32 ≥768px / 16 below.
    innerPaddingX: "16px",
    innerPaddingY: "16px",
    innerPaddingYMd: "32px",
    dividerColor: "#9ca3af",
    dividerMarginY: "24px", // my-6 (32px ≥1024px)
    dividerMarginYLg: "32px",
    navLinkGap: "24px", // me-6 at ≥768px / 16px below
    navLinkGapSm: "16px",
    navListMarginBottom: "24px", // ul mb-6 below 640px
    legalTextAlign: "justify",
    legalMarginBottom: "16px",
    copyrightPaddingBottom: "69px", // pb-[69px] below 1024px
    copyrightPaddingBottomLg: "40px", // lg:pb-10
  },
};

// Mobile headline variant (tokens.articleHeadline fontSizeMobile /
// lineHeightMobile are DIRECT measured fields — 24px/32px + the same 4px
// padding-y; the <640px breakpoint is recorded in the measuredMobileNote).
export const HEADLINE_MOBILE_BREAKPOINT: DerivedValue = {
  source: "articleHeadline.measuredMobileNote",
  evidence: ["640px", "24px/32px"],
  values: { maxWidth: "639px" },
};

// The reference's lg: breakpoint (≥1024px) — recorded across several
// measured notes ("<1024px", ">=1024px").
export const LG_BREAKPOINT_PX = 1024;

// Every prose-derived entry, for the conformance test to walk.
export const ALL_DERIVED_VALUES: Readonly<Record<string, DerivedValue>> = {
  ...DRIFT_OVERRIDES_2026_07_03,
  disclosurePanel: DISCLOSURE_PANEL,
  sectionDivider: SECTION_DIVIDER,
  sectionHeadingWrapper: SECTION_HEADING_WRAPPER,
  sectionHeadingLg: SECTION_HEADING_LG,
  headingNumberBadge: HEADING_NUMBER_BADGE,
  sectionImageGaps: SECTION_IMAGE_GAPS,
  buttonGroupGrid: BUTTON_GROUP_GRID,
  groupFollowupCta: GROUP_FOLLOWUP_CTA,
  legalBand: LEGAL_BAND,
  footerMeasured: FOOTER_MEASURED,
  headlineMobileBreakpoint: HEADLINE_MOBILE_BREAKPOINT,
};

// Resolve a tokens.ts dot-path to its raw value (string or object) so the
// conformance test can locate each entry's source prose.
export function resolveTokenPath(path: string): unknown {
  let node: unknown = T;
  for (const part of path.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
