// tokens → scoped static-chrome CSS for the default funnel design (contract
// 05 §14.2/§14.3). Mirrors the Listicles tokens-to-css discipline
// (public/listicle/layouts/default/{tokens-to-css,styles}.ts): NO CSS value
// here is hand-written where a token exists; every rule reads a design token.
//
// §14.3 boundary: this module is the STATIC chrome — page / header / progress /
// headline / inputs / buttons / cards / badge / range / validation, plus the
// interaction STATES (hover / selected / focus / disabled / error / loading)
// that inline per-instance styles cannot express. Per-INSTANCE styling (a
// choice's icon, a range's filled width, a grid's column count) is emitted
// inline by the presets (components/presets.ts). No preset emits a `<style>`
// block that reads instance data (§14.3 / §14.10).
//
// Everything is scoped under a root data-attribute so funnel chrome can never
// leak into the surrounding admin/page CSS.

import type { DefaultFunnelDesign } from "./tokens";
// v2.5 (13 §13.1): the theme module's widened design (EffectiveFunnelDesign =
// the SAME FunnelDesign structure with resolved/scaled leaf values) + the role
// vocabulary the frame-region rules resolve through. theme.ts has no runtime
// import back into this module (its registry import is type-only) — no cycle.
import { FUNNEL_TOKEN_ROLES, baseTokenForRole } from "../theme";
import type { EffectiveFunnelDesign } from "../theme";

// The scope every rule is nested under. Stage B sets this attribute on the
// funnel shell root; the same attribute value is the design id.
export const FUNNEL_DESIGN_SCOPE_ATTR = "data-funnel-design";
export const DEFAULT_FUNNEL_SCOPE = '[data-funnel-design="default-funnel"]';

function decls(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

function rule(selector: string, pairs: Record<string, string>): string {
  const body = decls(pairs);
  return body === "" ? "" : `${selector}{${body}}`;
}

// v2.5 13 §13.1 chrome-CSS extension switch. `frameRegions: true` appends the
// frame-region rules (`.lg-frame-*`, emitted by designs/frame.ts markup) into
// the SAME stylesheet — still one <style> block in the shell. Default OFF:
// every existing caller gets byte-identical output (the legacy shell pin +
// the render/parity regression suites embed the current CSS).
export interface FunnelChromeCssOpts {
  frameRegions?: boolean;
}

// tokens → the full scoped chrome stylesheet for one funnel design. `scope`
// defaults to the default-funnel scope; a different design passes its own.
// Accepts the registry's literal design OR a resolveTokens() EffectiveTokens
// `design` (widened leaves, same structure — 09 §9.2).
export function funnelChromeCss(
  design: DefaultFunnelDesign | EffectiveFunnelDesign,
  scope: string = DEFAULT_FUNNEL_SCOPE,
  opts?: FunnelChromeCssOpts,
): string {
  const out: string[] = [];
  const mobile: string[] = [];

  const {
    page,
    color,
    spacing,
    radius,
    shadow,
    header,
    backButton,
    disclosure,
    content,
    questionCard,
    progress,
    headline,
    subheadline,
    categoryLabel,
    rangeQuestion,
    primaryButton,
    reassuranceBadge,
    secureFormBadge,
    successState,
    trustBar,
    logoStrip,
    stepIndicator,
    iconCardGrid,
    answerGrid,
    iconCard,
    input,
    dropdown,
    validation,
    transitions,
    breakpoints,
    banner,
    columns,
    cardPanel,
    backgroundPanel,
    headerBar,
    footerBar,
  } = design;

  // ---- root: page group + design tokens exposed as custom properties -------
  // Emitting spacing / radius / shadow / transitions / breakpoints / colour as
  // CSS custom properties keeps EVERY §14.2 group represented on the scope
  // root (and lets presets reference them) without leaking globals.
  out.push(
    rule(scope, {
      "background-color": page.backgroundColor,
      color: page.textColor,
      "font-family": page.fontFamily,
      "min-height": page.minHeight,
      // color group
      "--lg-primary": color.primary,
      "--lg-primary-dark": color.primaryDark,
      "--lg-accent": color.accent,
      "--lg-card": color.card,
      "--lg-border": color.border,
      "--lg-success": color.success,
      "--lg-error": color.error,
      "--lg-primary-wash": color.primaryWash,
      // spacing group
      "--lg-space-xs": spacing.xs,
      "--lg-space-sm": spacing.sm,
      "--lg-space-md": spacing.md,
      "--lg-space-lg": spacing.lg,
      "--lg-space-xl": spacing.xl,
      "--lg-space-xxl": spacing.xxl,
      // radius group
      "--lg-radius-sm": radius.sm,
      "--lg-radius-md": radius.md,
      "--lg-radius-lg": radius.lg,
      "--lg-radius-xl": radius.xl,
      "--lg-radius-full": radius.full,
      // shadow group
      "--lg-shadow-sm": shadow.sm,
      "--lg-shadow-md": shadow.md,
      "--lg-shadow-lg": shadow.lg,
      "--lg-shadow-xl": shadow.xl,
      "--lg-shadow-glow": shadow.glow,
      // transitions group
      "--lg-transition-step": `${transitions.stepFadeInMs}ms`,
      "--lg-transition-card": `${transitions.cardHoverMs}ms`,
      "--lg-transition-btn": `${transitions.btnHoverMs}ms`,
      "--lg-transition-progress": `${transitions.progressFillMs}ms`,
      "--lg-btn-easing": transitions.btnEasing,
      // breakpoints group
      "--lg-bp-mobile-max": breakpoints.mobileMax,
      "--lg-bp-small-max": breakpoints.smallMax,
      "--lg-bp-tiny-max": breakpoints.tinyMax,
      "--lg-bp-desktop-min": breakpoints.desktopMin,
      "--lg-bp-wide-min": breakpoints.wideMin,
    }),
  );

  // ---- content container (§14.2 content) ----------------------------------
  out.push(
    rule(`${scope} .lg-content`, {
      "max-width": content.maxWidth,
      "margin-left": "auto",
      "margin-right": "auto",
      padding: content.paddingDesktop,
      "box-sizing": "border-box",
    }),
  );
  mobile.push(rule(`${scope} .lg-content`, { padding: content.paddingMobile }));

  // ---- R7 U12 FIX 3b: the question card (golden :308) ---------------------
  // The section-unit's DEFAULT composition (presets.ts renderQuestionCard) —
  // in the BASE sheet (never frameRegions-gated) so it reaches EVERY caller
  // identically: studio canvas, admin preview simulator, live funnel
  // (frameless legacy AND frame-composed alike). See the frame-coherence note
  // at renderQuestionCard's definition + the neutralized `.lg-frame-slot--card`
  // rule below (frameRegions block) for the "exactly one card, both
  // directions" mechanism.
  // R7 U11b/U12 FIX (browser-measurement finding, 2026-07-15): the golden's
  // OWN canvas markup (golden :296-308) proves the card is the ONLY padding
  // layer — a bare `width:600px` column directly containing the padded card,
  // no intermediate padded wrapper. `.lg-content`'s own horizontal padding
  // (content.paddingDesktop/Mobile — pre-existing, serves the `.lg-banners`
  // sibling mount which is NOT card-wrapped) would otherwise DOUBLE-PAD the
  // card (confirmed via a real browser measurement: a width:m FreeText
  // measured a 13px off-center — .lg-content's 452px content-box minus the
  // card's own 92px horizontal padding left only 360px, not enough for a
  // 384px field to center, let alone fit). Canceling `.lg-content`'s
  // padding on the card ALONE (negative margin, not a blanket removal) frees
  // the card to use `.lg-content`'s FULL border-box width for its own
  // golden-exact 46px/side padding, matching the golden's real structure,
  // WITHOUT touching `.lg-banners`' own inset (a sibling, untouched).
  out.push(
    rule(`${scope} .lg-question-card`, {
      background: questionCard.background,
      border: questionCard.border,
      "border-radius": questionCard.borderRadius,
      "box-shadow": questionCard.boxShadow,
      padding: questionCard.paddingDesktop,
      "box-sizing": "border-box",
      "margin-left": `calc(-1 * ${content.paddingDesktop})`,
      "margin-right": `calc(-1 * ${content.paddingDesktop})`,
    }),
  );
  mobile.push(
    rule(`${scope} .lg-question-card`, {
      padding: questionCard.paddingMobile,
      // same padding-cancellation, using the MOBILE .lg-content padding value.
      "margin-left": `calc(-1 * ${content.paddingMobile})`,
      "margin-right": `calc(-1 * ${content.paddingMobile})`,
    }),
  );

  // ---- P1a inter-component rhythm (register PC-3) -------------------------
  // The section-unit's vertical rhythm: a stack FLOOR between EVERY adjacent
  // pair of the unit's components. renderSectionComponents wraps the depth-1
  // component list in ONE `.lg-question-card` (presets.ts), and the studio
  // canvas + admin preview + live funnel (framed AND frameless) all take that
  // SAME wrapper — so `.lg-question-card > * + *` is the ONE selector that
  // reaches every component pair identically across all four surfaces (the
  // `.lg-content`/`<section>` wrappers exist only on the live shell, not the
  // studio canvas; the card exists everywhere). Pre-P1a these gaps measured 0
  // wherever a component carried no margin-bottom of its own (button groups,
  // yes/no, text blocks) — the operator's "default gaps don't exist" finding.
  //
  // MECHANISM = margin-collapse FLOOR + cascade-preserved golden overrides.
  // This rule is emitted HERE, BEFORE the per-component margin rules below
  // (.lg-headline :~325, .lg-subheadline :~331, .lg-continue :~458), so at EQUAL
  // specificity (both selectors are 1 attr + 1 class = (0,2,0)) source order
  // decides and each of those elements' OWN later margin-top declaration WINS:
  //   • .lg-subheadline `margin:0 0 30px 0` re-states margin-top:0 → the golden
  //     headline→sub 9px (the headline's OWN margin-bottom) survives the 18px
  //     floor (this is the ONE golden gap below the floor; every other golden
  //     gap is ≥18 and simply wins by margin-collapse max);
  //   • .lg-continue `margin-top:26px` → the golden helper→Continue 26px stands
  //     (and the U14 measured-centering gate reads marginTop=="26px").
  // Every component WITHOUT its own margin-top (answer groups, yes/no, text
  // blocks, range, …) inherits the 18px floor; every preceding margin-bottom
  // ≥18 (card-grid 24, progress 32, steps 24) still wins by collapse-max. Pinned
  // by leadgen-r3a-effects.gesture (rendered gaps) + leadgen-p1-geometry.gesture
  // (the new rhythm gate); the CSS-body pins in leadgen-u12-rhythm read the
  // .lg-headline/.lg-subheadline/.lg-continue rule BODIES, which are untouched.
  //
  // MINOR-1 (adversarial review, register PC): `.lg-question-card > * + *` is a
  // DIRECT-CHILD combinator — it reaches a §8.5 container's OWN position among
  // its question-card siblings, but NOT a plain-block container's children
  // (its grandchildren, one level deeper). The reviewer's probe found exactly
  // this: two components nested inside a CardPanel measured 0px apart.
  //
  // SCOPING RULE (encoded here for every future §8.5 container): a container
  // with EXPLICIT gap semantics owns its OWN internal spacing and must NOT get
  // this floor —
  //   • Stack   (renderStack)         — inline `gap` from stackGapValue, ALWAYS
  //                                      emitted (an un-authored gap still
  //                                      resolves to the token default).
  //   • GridContainer (renderGridContainer) — inline `gap` from gridGapValue,
  //                                      same always-emitted guarantee.
  //   • Columns (`.lg-columns`, above) — `gap: columns.gap` in THIS class rule.
  // A container with NO gap mechanism at all — a plain block — falls back to
  // this SAME stack floor, exactly like `.lg-question-card` itself:
  //   • CardPanel (`.lg-card-panel`, ~line 1098) — renderCardPanel emits no
  //     gap; the class rule is width/margin/border only.
  //   • BackgroundPanel (`.lg-bg-panel`, ~line 1110) — renderBackgroundPanel
  //     renders children inside the INNER wrapper `.lg-bg-panel-inner`
  //     (position:relative only, no gap); the floor targets that inner
  //     element, not `.lg-bg-panel` itself (children are ITS direct children,
  //     not the outer panel's — the outer panel's only other child is the
  //     absolutely-positioned `.lg-bg-panel-img`, which this selector does not
  //     reach: `img + *` never matches inside `.lg-bg-panel` itself, only
  //     inside `.lg-bg-panel-inner`).
  // Swept ALL 5 LEADGEN_CONTAINER_TYPES (content-schema.ts) against this rule:
  // no 6th plain-block container exists today; a future one must repeat this
  // audit (does its OWN renderX emit a gap? no → add it here).
  //
  // AUDITED against the grid-follower collapse-emulation table below (P1a FIX
  // ROUND): that table's selectors (`${scope} <predecessor> + <follower>`) are
  // ALREADY container-agnostic — a sibling-combinator selector matches an
  // adjacent pair regardless of which element wraps them, so it governs a
  // CardPanel-nested or BackgroundPanel-nested pair identically to a
  // question-card-level one, with NO changes needed. Its selectors are also
  // HIGHER specificity ((0,3,0): scope + 2 classes) than this floor's (0,2,0):
  // scope + 1 class, `*` contributes none) — so it always wins the tie where
  // both could apply. Every margin-bottom/margin-shorthand-bearing selector in
  // this file was enumerated (grep audit, register PC): .lg-progress(32),
  // .lg-category(12), .lg-steps(24), .lg-card-grid(24, predecessor case),
  // .lg-field(16), .lg-grid-container(24), .lg-columns(16), .lg-headline(9),
  // .lg-subheadline(30), .lg-trustbar(16), .lg-logo-strip(16) — ALL already
  // enumerated in that table's predecessor list. The remaining margin-bearing
  // selectors (.lg-range-value/.lg-label/.lg-dropdown-search) are nested-only
  // (never a direct container child anywhere, panel or not — unchanged from
  // the original P1a audit) and every frame-region `margin:` (`.lg-frame-*`)
  // is structural chrome, never an author-authored container child.
  out.push(
    rule(`${scope} .lg-question-card > * + *`, { "margin-top": spacing.stack }),
    rule(`${scope} .lg-card-panel > * + *`, { "margin-top": spacing.stack }),
    rule(`${scope} .lg-bg-panel-inner > * + *`, { "margin-top": spacing.stack }),
  );
  // Mobile: a tighter floor; re-assert the two golden overrides AFTER it (the
  // mobile array becomes ONE media query at the end of the sheet, so these must
  // follow the mobile stack in source to win it — keeping the desktop-golden
  // rhythm identical on mobile, where it was already inherited from the base).
  // `.lg-subheadline`/`.lg-continue` are GLOBAL class selectors (not scoped to
  // a specific ancestor), so the SAME two re-assertions cover a CardPanel- or
  // BackgroundPanel-nested instance of either without duplication.
  mobile.push(
    rule(`${scope} .lg-question-card > * + *`, { "margin-top": spacing.stackMobile }),
    rule(`${scope} .lg-card-panel > * + *`, { "margin-top": spacing.stackMobile }),
    rule(`${scope} .lg-bg-panel-inner > * + *`, { "margin-top": spacing.stackMobile }),
  );
  mobile.push(rule(`${scope} .lg-subheadline`, { "margin-top": "0" }));
  mobile.push(rule(`${scope} .lg-continue`, { "margin-top": "26px" }));

  // ---- header (§14.2 header) ----------------------------------------------
  out.push(
    rule(`${scope} .lg-header`, {
      "background-color": header.backgroundColor,
      padding: `${header.paddingY} ${header.paddingX}`,
      "box-shadow": header.boxShadow,
      position: header.position,
      top: "0",
      "z-index": "20",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "text-align": header.align,
    }),
    rule(`${scope} .lg-header-inner`, {
      width: "100%",
      "max-width": header.contentMaxWidth,
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: spacing.md,
    }),
    rule(`${scope} .lg-logo`, {
      "font-family": header.logoFontFamily,
      "font-size": header.logoFontSize,
      "font-weight": header.logoFontWeight,
      color: header.logoColor,
      "text-decoration": "none",
    }),
    rule(`${scope} .lg-logo-accent`, { color: header.logoAccentColor }),
  );

  // ---- back button (§14.2 backButton) -------------------------------------
  out.push(
    rule(`${scope} .lg-back`, {
      background: "none",
      border: "0",
      cursor: "pointer",
      color: backButton.color,
      "font-size": backButton.fontSize,
      "font-family": "inherit",
      padding: "0",
      display: "inline-flex",
      "align-items": "center",
      gap: spacing.xs,
      "min-height": "44px",
    }),
    rule(`${scope} .lg-back:hover`, { color: backButton.hoverColor }),
  );

  // ---- disclosure link (§14.2 disclosure) ---------------------------------
  out.push(
    rule(`${scope} .lg-disclosure`, {
      background: "none",
      border: "0",
      cursor: "pointer",
      color: disclosure.color,
      "font-size": disclosure.fontSize,
      "font-family": "inherit",
      "text-decoration": "underline",
    }),
    rule(`${scope} .lg-disclosure:hover`, { color: disclosure.hoverColor }),
  );

  // ---- progress bar (§14.2 progress) --------------------------------------
  out.push(
    rule(`${scope} .lg-progress`, { "margin-bottom": progress.marginBottom }),
    rule(`${scope} .lg-progress-track`, {
      height: progress.height,
      "background-color": progress.trackColor,
      "border-radius": progress.borderRadius,
      overflow: "hidden",
    }),
    rule(`${scope} .lg-progress-fill`, {
      height: "100%",
      background: progress.fillColor,
      "border-radius": progress.borderRadius,
      transition: `width var(--lg-transition-progress) ease`,
    }),
    rule(`${scope} .lg-progress-text`, {
      color: progress.textColor,
      "font-size": "0.7rem",
      "font-weight": "600",
      "margin-top": spacing.xs,
    }),
  );

  // ---- category label (§14.2 categoryLabel) -------------------------------
  out.push(
    rule(`${scope} .lg-category`, {
      "font-size": categoryLabel.fontSize,
      "font-weight": categoryLabel.fontWeight,
      "letter-spacing": categoryLabel.letterSpacing,
      "text-transform": categoryLabel.textTransform,
      color: categoryLabel.color,
      "margin-bottom": categoryLabel.marginBottom,
    }),
  );

  // ---- headline + subheadline (§14.2 headline / subheadline) --------------
  out.push(
    rule(`${scope} .lg-headline`, {
      "font-family": headline.fontFamily,
      "font-size": headline.fontSizeDesktop,
      "font-weight": headline.fontWeight,
      "line-height": headline.lineHeight,
      color: headline.color,
      "text-align": headline.textAlign,
      "text-wrap": "balance",
      margin: `0 0 ${headline.marginBottom} 0`,
    }),
    rule(`${scope} .lg-subheadline`, {
      "font-size": subheadline.fontSize,
      color: subheadline.color,
      "text-align": subheadline.textAlign,
      margin: `0 0 ${subheadline.marginBottom} 0`,
    }),
    // R5 D11 (register S4-B2, conductor-ratified blast-radius discipline): a
    // SURGICAL, later same-selector declaration overrides ONLY the question-
    // card subheadline's font-size to golden's 15px (golden :313) — the
    // SHARED subheadline.fontSize TOKEN above (0.825rem) is deliberately left
    // UNTOUCHED because it also feeds .lg-card-desc (icon-card choice
    // descriptions) and other non-headline consumers this deliverable does
    // not touch. Same specificity (bare class selector) + later source order
    // = this wins the font-size property only; color/text-align/margin from
    // the rule above are unaffected.
    rule(`${scope} .lg-subheadline`, { "font-size": "15px" }),
  );
  mobile.push(rule(`${scope} .lg-headline`, { "font-size": headline.fontSizeMobile }));

  // ---- range question (§14.2 rangeQuestion) -------------------------------
  out.push(
    rule(`${scope} .lg-range-value`, {
      "font-family": rangeQuestion.valueFontFamily,
      "font-size": rangeQuestion.valueFontSize,
      "font-weight": rangeQuestion.valueFontWeight,
      color: rangeQuestion.valueColor,
      "text-align": "center",
      margin: `${spacing.md} 0`,
    }),
    rule(`${scope} .lg-range-track`, {
      position: "relative",
      height: rangeQuestion.trackHeight,
      "background-color": rangeQuestion.unfilledTrackColor,
      "border-radius": rangeQuestion.trackRadius,
    }),
    rule(`${scope} .lg-range-fill`, {
      position: "absolute",
      left: "0",
      top: "0",
      height: "100%",
      "background-color": rangeQuestion.filledTrackColor,
      "border-radius": rangeQuestion.trackRadius,
    }),
    // Native range input drives keyboard + role=slider semantics; the visual
    // track/fill above sit behind it. The input itself is transparent.
    rule(`${scope} .lg-range-input`, {
      "-webkit-appearance": "none",
      appearance: "none",
      width: "100%",
      background: "transparent",
      margin: "0",
      "min-height": "44px",
    }),
    rule(`${scope} .lg-range-input::-webkit-slider-thumb`, {
      "-webkit-appearance": "none",
      appearance: "none",
      width: rangeQuestion.thumbSize,
      height: rangeQuestion.thumbSize,
      "border-radius": radius.full,
      background: rangeQuestion.thumbBackground,
      border: rangeQuestion.thumbBorder,
      "box-shadow": rangeQuestion.thumbShadow,
      cursor: "pointer",
    }),
    rule(`${scope} .lg-range-input::-moz-range-thumb`, {
      width: rangeQuestion.thumbSize,
      height: rangeQuestion.thumbSize,
      "border-radius": radius.full,
      background: rangeQuestion.thumbBackground,
      border: rangeQuestion.thumbBorder,
      "box-shadow": rangeQuestion.thumbShadow,
      cursor: "pointer",
    }),
    rule(`${scope} .lg-range-minmax`, {
      display: "flex",
      "justify-content": "space-between",
      color: rangeQuestion.minMaxLabelColor,
      "font-size": "0.8125rem",
      "margin-top": spacing.sm,
    }),
  );

  // ---- primary button + continue + auto-advance (§14.2 primaryButton) -----
  // Base pill; states (hover/active/disabled/loading) live here (not inline).
  const btnBase: Record<string, string> = {
    display: "inline-flex",
    "align-items": "center",
    "justify-content": "center",
    gap: spacing.sm,
    background: primaryButton.background,
    color: primaryButton.color,
    padding: `${primaryButton.paddingY} ${primaryButton.paddingX}`,
    "min-height": primaryButton.minHeight,
    "border-radius": primaryButton.borderRadius,
    border: "0",
    "font-family": primaryButton.fontFamily,
    "font-size": primaryButton.fontSize,
    "font-weight": primaryButton.fontWeight,
    cursor: "pointer",
    "box-sizing": "border-box",
    transition: `background var(--lg-transition-btn) var(--lg-btn-easing)`,
  };
  out.push(
    rule(`${scope} .lg-btn`, btnBase),
    rule(`${scope} .lg-btn:hover`, { background: primaryButton.hoverBackground }),
    rule(`${scope} .lg-btn:active`, { transform: "scale(0.98)" }),
    rule(`${scope} .lg-btn:disabled, ${scope} .lg-btn[aria-disabled="true"]`, {
      opacity: primaryButton.disabledOpacity,
      cursor: "not-allowed",
    }),
    // Continue is the full-width centred pill (§14.6): navy, NOT blue. The base
    // navy background lives on the shared .lg-btn rule above; here .lg-continue
    // (and .lg-auto-advance) additionally read the §14.8 --lg-btn-bg override
    // custom property (token navy fallback) at REST — kept off .lg-btn so the
    // higher-specificity .lg-btn:hover darken still wins by cascade (no !important).
    rule(`${scope} .lg-continue`, {
      // U14 (operator's 3rd retest — "Continue renders left-aligned, cannot be
      // centered any way"): .lg-continue inherits display:inline-flex from the
      // shared .lg-btn base, and margin-left/right:auto compute to 0 on an
      // INLINE-level box (auto margins only center a BLOCK-level box). Setting
      // display:flex makes .lg-continue block-level so its auto side-margins DO
      // center it within the question card; btnBase already sets
      // align-items:center + justify-content:center, so the label stays centered
      // inside the pill. This is the §14.6 "full-width centred pill".
      display: "flex",
      width: "100%",
      "max-width": primaryButton.maxWidth,
      // R7 U12: helper→Continue gap = golden :350's margin-top:26px (the
      // fail-before was 0 — .lg-continue carried no top margin). This is the
      // UNFRAMED inside_unit path; the framed below_unit slot owns its own 26
      // and RESETS this to 0 (below) so the two never double-space.
      "margin-top": "26px",
      "margin-left": "auto",
      "margin-right": "auto",
      background: `var(--lg-btn-bg, ${primaryButton.background})`,
    }),
    rule(`${scope} .lg-auto-advance`, {
      background: `var(--lg-btn-bg, ${primaryButton.background})`,
    }),
    // Loading state: hide the label, show the spinner (§14.6).
    rule(`${scope} .lg-btn[data-loading="true"] .lg-btn-label`, { visibility: "hidden" }),
    rule(`${scope} .lg-btn-spinner`, { display: "none" }),
    rule(`${scope} .lg-btn[data-loading="true"] .lg-btn-spinner`, {
      display: "inline-block",
      width: "1em",
      height: "1em",
      border: `2px solid ${primaryButton.color}`,
      "border-top-color": "transparent",
      "border-radius": radius.full,
      animation: "lg-spin 0.6s linear infinite",
    }),
  );
  mobile.push(rule(`${scope} .lg-continue`, { width: primaryButton.widthMobile }));
  out.push(`@keyframes lg-spin{to{transform:rotate(360deg)}}`);

  // ---- P1a answer-group layout system (register PC-1) --------------------
  // `.lg-answer-group` (ButtonAnswerGroup + .lg-yesno TwoButtonYesNo) is a REAL
  // CSS grid, replacing the pre-P1a flow-packed inline-flex chips that measured
  // 0-gap, unequal, left-stuck (the operator's finding). Equal `minmax(0,1fr)`
  // tracks give EQUAL cells (the 0-min lets a long label wrap instead of
  // widening its track); the default 2 columns and the answerGrid.gap token
  // come from tokens.ts (authorable per-node via --lg-cols / inline gap, emitted
  // by presets.ts answerGroupRootStyle). width:100% fills the card column so the
  // group is centered by construction; an authored fixed width (s/m/l) arrives
  // inline and centers via auto side-margins (widthCenteringEntries — the U11b
  // pin). The .lg-btn.lg-btn-answer cells are grid items → they stretch to fill
  // their track (blockified inline-flex, justify-self:stretch) and keep min-
  // height:52 (primaryButton.minHeight, inherited from .lg-btn). Mobile keeps
  // the column count (buttons don't collapse like cards) and only narrows the
  // gutter. Pinned by leadgen-u11-centering (inline centering) + the new
  // leadgen-p1-geometry.gesture gate (equal cells, gap, centering, ≥52 height).
  out.push(
    rule(`${scope} .lg-answer-group`, {
      display: "grid",
      "grid-template-columns": `repeat(var(--lg-cols, ${answerGrid.columns}), minmax(0, 1fr))`,
      gap: answerGrid.gap,
      width: "100%",
      // P2b (register R-A completion): a multi-column group whose choices
      // carry PER-CHOICE heights (choice.style.size) must let each item show
      // its own min-height — grid's default align-items:stretch equalizes
      // every cell in a row to the tallest, hiding the very variation P2a's
      // per-choice size axis exists to produce. Additive: the grid's OWN gap/
      // columns/width are untouched, and a group with no per-choice sizing
      // still centers/stretches its equal-min-height buttons identically
      // (start-aligned single-row items whose min-heights already match render
      // pixel-identical either way).
      "align-items": "start",
    }),
  );
  mobile.push(rule(`${scope} .lg-answer-group`, { gap: answerGrid.gapMobile }));

  // ---- answer buttons (§14.6 selected animation / §13.2 TwoButtonYesNo +
  // ButtonAnswerGroup) ------------------------------------------------------
  // An answer button is a "pick-one" affordance like the icon card — a white
  // 2px-bordered chip that washes navy when selected, NOT the navy primary FILL.
  // Its base + hover + selected + focus chrome lives here (never inline in the
  // preset) so the state rules win by cascade. The compound .lg-btn.lg-btn-answer
  // (two classes) cleanly outranks both the .lg-btn primary base AND .lg-btn:hover
  // without !important or source-order dependence, so the shared primary navy
  // fill/hover can never bleed onto a white answer button. Every value REUSES an
  // existing token (no new values): base = color.card / page.textColor /
  // input.border; hover + selected = the SAME iconCard state tokens the icon card
  // uses (§14.4); focus ring = the .lg-card:focus-visible ring.
  out.push(
    rule(`${scope} .lg-btn.lg-btn-answer`, {
      // P2b (register R-A completion): the RESTING background now reads
      // choiceStyleOverlayEntries' state-safe --lg-answer-bg custom property
      // (presets.ts, P2a), falling back to the UNCHANGED color.card token —
      // the exact --lg-field-border idiom immediately below. Unset (no
      // per-choice color/color_hex authored, the common case) resolves
      // byte-identically to pre-P2b. The var sits on THIS resting declaration
      // ONLY — :hover / [aria-checked="true"] / [data-selected="true"] below
      // set `background` DIRECTLY (higher specificity: a pseudo-class/
      // attribute selector beats a bare compound-class declaration) and so
      // still win while hovered/selected regardless of what --lg-answer-bg
      // resolves to.
      background: `var(--lg-answer-bg, ${color.card})`,
      color: page.textColor,
      border: input.border,
      // R5 state-safe border (register R3a ROUTING NOTES): a LATER
      // declaration in the SAME rule overrides just the color channel of the
      // `border` shorthand above (same specificity, source order decides).
      // presets.ts's choiceItemStyle supplies a per-node design_overrides.
      // border_color role as an inline CUSTOM PROPERTY on the RESTING state
      // only — :hover / [aria-checked="true"] / [data-selected="true"] below
      // set border-color/background DIRECTLY (higher specificity: a
      // pseudo-class/attribute selector beats a bare compound-class
      // declaration) and so still win over this var-driven default. Unset
      // (no per-item override authored, the common case) falls back to
      // color.border — the SAME token nodeBorderColorCss resolves to for
      // "neutral", so "no override" and "explicit neutral" render byte-
      // identically by construction (mirrors the .lg-input idiom below).
      "border-color": `var(--lg-field-border, ${color.border})`,
      transition: `border-color var(--lg-transition-card), background var(--lg-transition-card)`,
    }),
    rule(`${scope} .lg-btn.lg-btn-answer:hover`, {
      "border-color": iconCard.hoverBorderColor,
      background: iconCard.hoverBackground,
    }),
    rule(
      `${scope} .lg-btn.lg-btn-answer[aria-checked="true"], ${scope} .lg-btn.lg-btn-answer[data-selected="true"]`,
      {
        "border-color": iconCard.selectedBorderColor,
        background: iconCard.selectedBackground,
        "font-weight": "700",
      },
    ),
    rule(`${scope} .lg-btn.lg-btn-answer:focus-visible`, {
      outline: `2px solid ${color.primary}`,
      "outline-offset": "2px",
    }),
    // ---- v2.5 answer-group selected-state override consumption (FIX 4a,
    // DEV-68 coordinated re-pin) ---------------------------------------------
    // The curated §14.8 `buttonBackground` override on ButtonAnswerGroup /
    // TwoButtonYesNo / OtherGroupSelector rides the GROUP root as the
    // --lg-sel-bg custom property (presets.ts answerGroupSelectedVar —
    // additive markup; absent override emits nothing). This rule re-states
    // the §14.6 selected background THROUGH the var with the SAME iconCard
    // token as the fallback: var unset ⇒ identical computed style; set ⇒
    // the resolved role/hex wins (later source order at equal specificity
    // beats the §14.6 base rule above). The --lg-sel-bg markup emission is
    // ungated and frame-independent, so the consumer belongs in the BASE
    // sheet — moved here from the frameRegions-gated block (DEV-68; the
    // coordinated legacy-pin re-pin carries the byte change; with no
    // override the var fallback keeps legacy rendering pixel-identical).
    rule(
      `${scope} .lg-btn.lg-btn-answer[aria-checked="true"], ${scope} .lg-btn.lg-btn-answer[data-selected="true"]`,
      { background: `var(--lg-sel-bg, ${iconCard.selectedBackground})` },
    ),
  );

  // ---- reassurance badge (§14.2 reassuranceBadge / §14.7) -----------------
  out.push(
    rule(`${scope} .lg-badge`, {
      display: "inline-flex",
      "align-items": "center",
      gap: reassuranceBadge.gap,
      border: reassuranceBadge.border,
      background: reassuranceBadge.background,
      "border-radius": reassuranceBadge.borderRadius,
      padding: `${reassuranceBadge.paddingY} ${reassuranceBadge.paddingX}`,
      color: reassuranceBadge.textColor,
      "font-size": reassuranceBadge.fontSize,
    }),
    rule(`${scope} .lg-badge-icon`, { color: reassuranceBadge.iconColor, "line-height": "1" }),
  );

  // ---- secure form badge (08 §8.3 SecureFormBadge) -------------------------
  out.push(
    rule(`${scope} .lg-secure-badge`, {
      display: "inline-flex",
      "align-items": "center",
      gap: secureFormBadge.gap,
      border: secureFormBadge.border,
      background: secureFormBadge.background,
      "border-radius": secureFormBadge.borderRadius,
      padding: `${secureFormBadge.paddingY} ${secureFormBadge.paddingX}`,
      color: secureFormBadge.textColor,
      "font-size": secureFormBadge.fontSize,
    }),
    rule(`${scope} .lg-secure-badge-icon`, { color: secureFormBadge.iconColor, "line-height": "1" }),
  );

  // ---- success state (08 §8.10 SuccessState) -------------------------------
  out.push(
    rule(`${scope} .lg-success`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: spacing.sm,
      border: successState.border,
      background: successState.background,
      "border-radius": successState.borderRadius,
      padding: successState.padding,
      "text-align": "center",
    }),
    rule(`${scope} .lg-success-icon`, {
      color: successState.iconColor,
      "font-size": successState.iconSize,
      "line-height": "1",
    }),
    rule(`${scope} .lg-success-heading`, {
      "font-family": successState.headingFontFamily,
      "font-size": successState.headingFontSize,
      "font-weight": "700",
      color: successState.headingColor,
    }),
    rule(`${scope} .lg-success-message`, {
      color: successState.messageColor,
      "font-size": successState.messageFontSize,
      margin: "0",
    }),
  );

  // ---- trust bar (08 §8.3 TrustBar; stacked via modifier class) ------------
  out.push(
    rule(`${scope} .lg-trustbar`, {
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      "justify-content": "center",
      gap: trustBar.gap,
      margin: `${trustBar.marginY} 0`,
    }),
    rule(`${scope} .lg-trustbar-stacked`, {
      "flex-direction": "column",
      "align-items": "flex-start",
    }),
    rule(`${scope} .lg-trustbar-item`, {
      display: "inline-flex",
      "align-items": "center",
      gap: trustBar.itemGap,
      color: trustBar.textColor,
      "font-size": trustBar.fontSize,
    }),
    rule(`${scope} .lg-trustbar-icon`, { color: trustBar.iconColor, "line-height": "1" }),
  );

  // ---- logo strip (08 §8.3 LogoStrip) --------------------------------------
  out.push(
    rule(`${scope} .lg-logo-strip`, {
      display: "flex",
      "flex-wrap": "wrap",
      "align-items": "center",
      "justify-content": "center",
      gap: logoStrip.gap,
      margin: `${logoStrip.marginY} 0`,
    }),
    rule(`${scope} .lg-logo-strip-img`, {
      "max-height": logoStrip.logoMaxHeight,
      width: "auto",
      "object-fit": "contain",
      opacity: logoStrip.logoOpacity,
    }),
  );

  // ---- step indicator (08 §8.3 StepIndicator) ------------------------------
  out.push(
    rule(`${scope} .lg-steps`, {
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      gap: stepIndicator.gap,
      "margin-bottom": stepIndicator.marginBottom,
    }),
    rule(`${scope} .lg-step`, {
      width: stepIndicator.dotSize,
      height: stepIndicator.dotSize,
      "border-radius": radius.full,
      background: stepIndicator.dotColor,
    }),
    rule(`${scope} .lg-step[data-active="true"]`, { background: stepIndicator.activeColor }),
  );

  // ---- icon/answer card grid + card + states (§14.2 iconCardGrid/iconCard) -
  out.push(
    rule(`${scope} .lg-card-grid`, {
      display: "grid",
      // per-instance column count arrives inline as --lg-cols (2..5); default 3.
      "grid-template-columns": "repeat(var(--lg-cols, 3), minmax(0, 1fr))",
      gap: iconCardGrid.gap,
      "margin-bottom": iconCardGrid.marginBottom,
      // P2b (register R-A completion) — the .lg-answer-group twin above: a
      // per-choice height (choice.style.size) needs its own row instead of
      // grid's default stretch-to-tallest equalization.
      "align-items": "start",
    }),
  );
  // Mobile collapse (§14.4 mobile 1..2 cols): the grid falls to 1 column.
  mobile.push(rule(`${scope} .lg-card-grid`, { "grid-template-columns": "1fr" }));
  out.push(
    rule(`${scope} .lg-card`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      gap: spacing.xs,
      border: iconCard.border,
      // R5 state-safe border (register R3a ROUTING NOTES) — same idiom as
      // .lg-btn.lg-btn-answer above: a per-node border_color rides
      // --lg-field-border so :hover/[aria-checked="true"]/[data-selected=
      // "true"] below (higher specificity) still win. Fallback = color.border
      // = the SAME "neutral" resolution, so the unauthored case is
      // byte-identical.
      "border-color": `var(--lg-field-border, ${color.border})`,
      "border-radius": iconCard.borderRadius,
      // P2b (register R-A completion): the SAME --lg-answer-bg resting-state
      // read as .lg-btn.lg-btn-answer above — icon/image/multi-choice cards
      // share this ONE base rule, so a per-choice color/color_hex paints here
      // too. Fallback = the unchanged iconCard.background token; :hover /
      // [aria-checked="true"] / [data-selected="true"] below still set
      // `background` DIRECTLY and win over this var() by specificity.
      background: `var(--lg-answer-bg, ${iconCard.background})`,
      "min-height": iconCard.minHeight,
      padding: iconCard.padding,
      cursor: "pointer",
      "text-align": "center",
      transition: `border-color var(--lg-transition-card), background var(--lg-transition-card)`,
    }),
    rule(`${scope} .lg-card:hover`, {
      "border-color": iconCard.hoverBorderColor,
      background: iconCard.hoverBackground,
    }),
    // selected state (§14.4)
    rule(`${scope} .lg-card[aria-checked="true"], ${scope} .lg-card[data-selected="true"]`, {
      "border-color": iconCard.selectedBorderColor,
      background: iconCard.selectedBackground,
      "font-weight": "700",
    }),
    // keyboard focus (§14.4)
    rule(`${scope} .lg-card:focus-visible`, {
      outline: `2px solid ${color.primary}`,
      "outline-offset": "2px",
    }),
    // disabled state (§14.4)
    rule(`${scope} .lg-card[aria-disabled="true"], ${scope} .lg-card:disabled`, {
      opacity: iconCard.disabledOpacity,
      cursor: "not-allowed",
    }),
    // error state (§14.4)
    rule(`${scope} .lg-card[data-error="true"]`, { "border-color": iconCard.errorBorderColor }),
    // P1a (register PC-11): the icon slot centers its glyph without constraining
    // it — P1b's leadgenIconSvg(id,48) emits an explicit 48×48 <svg>, so an
    // inline-flex box sizes TO the 48px icon (never shrinks it) and centers a
    // legacy emoji glyph (text, iconCard.iconSize) identically. line-height:1
    // keeps the emoji strut tight.
    rule(`${scope} .lg-card-icon`, {
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      color: iconCard.iconColor,
      "font-size": iconCard.iconSize,
      "line-height": "1",
    }),
    rule(`${scope} .lg-card-title`, {
      "font-size": iconCard.titleFontSize,
      "font-weight": iconCard.titleFontWeight,
      color: iconCard.titleColor,
    }),
    rule(`${scope} .lg-card-desc`, {
      "font-size": subheadline.fontSize,
      color: page.textSecondaryColor,
    }),
    rule(`${scope} .lg-card-img`, {
      "max-height": "32px",
      width: "auto",
      "object-fit": "contain",
    }),
    // ---- v2.5 choice-depth base rules (08 §8.4, DEV-57 Phase-C move) --------
    // .lg-card-subtitle / .lg-card-badge style ONLY the new-choice-field
    // markup (no legacy content emits those classes), but the MARKUP is
    // frame-independent — a frameless funnel can render badge/subtitle
    // choices, so the rules belong in the BASE sheet. Moved here from the
    // frameRegions-gated block (a coordinated legacy-pin re-pin carries the
    // byte change; legacy rendering is pixel-identical).
    // .lg-card-subtitle — structural complement of the inline
    // iconCard.subtitle* tokens (font-size/color ride inline).
    rule(`${scope} .lg-card-subtitle`, {
      display: "block",
      "margin-top": spacing.xs,
      "line-height": "1.3",
    }),
    // .lg-card-badge positioning — top-right pill over the card corner
    // (the badge colours/typography ride inline via iconCard.badge*);
    // .lg-card{position:relative} is its positioning companion.
    rule(`${scope} .lg-card`, { position: "relative" }),
    rule(`${scope} .lg-card-badge`, {
      position: "absolute",
      top: spacing.xs,
      right: spacing.xs,
      "line-height": "1.2",
      "white-space": "nowrap",
    }),
  );

  // ---- inputs + fields + dropdown (§14.2 input / dropdown) ----------------
  out.push(
    rule(`${scope} .lg-field`, {
      display: "block",
      "margin-bottom": spacing.md,
    }),
    rule(`${scope} .lg-label`, {
      display: "block",
      "font-size": subheadline.fontSize,
      color: page.textSecondaryColor,
      "margin-bottom": spacing.xs,
    }),
    rule(`${scope} .lg-input`, {
      width: "100%",
      "box-sizing": "border-box",
      padding: input.padding,
      border: input.border,
      // v3.1 fix-round (adversarial review, CSS-cascade regression close-
      // out): a LATER declaration in the SAME rule overrides just the color
      // channel of the `border` shorthand above (same specificity, source
      // order decides). var(--lg-field-border, …) lets components/
      // presets.ts's fieldAppearanceStyle supply a per-field design_
      // overrides.border_color role as an inline CUSTOM PROPERTY on the
      // RESTING state only — :focus / [aria-invalid] below set border-color
      // DIRECTLY (higher specificity: a pseudo-class/attribute selector
      // beats a bare class) and so still win over this var-driven default
      // exactly as they did before this feature existed. Unset (no per-
      // field override authored, the common case) falls back to
      // color.border — the SAME token presets.ts's border_color:"neutral"
      // resolves to, so "no override" and "explicit neutral" render byte-
      // identically by construction.
      "border-color": `var(--lg-field-border, ${color.border})`,
      "border-radius": input.borderRadius,
      "font-size": input.fontSize,
      "font-family": "inherit",
      color: page.textColor,
      "min-height": "44px",
      background: color.card,
    }),
    rule(`${scope} .lg-input:focus`, {
      outline: "none",
      "border-color": input.focusBorderColor,
    }),
    rule(`${scope} .lg-input[aria-invalid="true"]`, { "border-color": input.errorBorderColor }),
    rule(`${scope} .lg-input::placeholder`, { color: input.placeholderColor }),
    // dropdown inherits input; custom chevron colour (§14.2 dropdown).
    rule(`${scope} .lg-dropdown`, {
      "-webkit-appearance": "none",
      "-moz-appearance": "none",
      appearance: "none",
      "background-image": `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'><path fill='${encodeURIComponent(dropdown.chevronSvgFill)}' d='M4 6l4 4 4-4z'/></svg>")`,
      "background-repeat": "no-repeat",
      "background-position": "right 16px center",
      "padding-right": "40px",
    }),
    // searchable dropdown (08 §8.3): the search input sits above the <select>.
    rule(`${scope} .lg-dropdown-search`, { "margin-bottom": spacing.sm }),
    // currency input (08 §8.10): prefix symbol aligned inside the input box;
    // the input clears it with token-derived left padding. R7 U12: input.padding
    // is now the golden's ASYMMETRIC "16px 18px" (V H) — `left` takes ONE value,
    // so derive the SIDE (horizontal) component (a 2-value shorthand → 2nd value,
    // a 1-value → itself) so the `$` still aligns to the input's real left inset.
    rule(`${scope} .lg-currency`, { position: "relative" }),
    rule(`${scope} .lg-currency-prefix`, {
      position: "absolute",
      left: (() => {
        const p = input.padding.trim().split(/\s+/);
        return p.length >= 2 ? p[1]! : p[0]!;
      })(),
      top: "50%",
      transform: "translateY(-50%)",
      color: page.textSecondaryColor,
      "font-size": input.fontSize,
      "pointer-events": "none",
    }),
    rule(`${scope} .lg-currency-input`, { "padding-left": spacing.xl }),
  );

  // ---- validation: error / helper / legal (§14.2 validation) --------------
  out.push(
    rule(`${scope} .lg-error`, {
      color: validation.errorTextColor,
      "font-size": validation.errorFontSize,
      "margin-top": spacing.xs,
    }),
    rule(`${scope} .lg-helper`, {
      color: validation.helperColor,
      "font-size": validation.errorFontSize,
      "margin-top": spacing.xs,
    }),
    rule(`${scope} .lg-legal`, {
      color: validation.helperColor,
      "font-size": "0.75rem",
      "line-height": "1.4",
    }),
    rule(`${scope} .lg-valid`, { color: validation.successColor }),
  );

  // ---- banner sub-design (§14.2 banner / §20) -----------------------------
  out.push(
    rule(`${scope} .lg-banner`, {
      border: banner.cardBorder,
      "border-radius": banner.cardRadius,
      padding: banner.cardPadding,
      background: color.card,
    }),
    rule(`${scope} .lg-banner[data-recommended="true"]`, {
      border: banner.recommendedBorder,
      background: banner.recommendedBg,
      "box-shadow": banner.recommendedGlow,
    }),
    rule(`${scope} .lg-banner-name`, {
      "font-size": banner.nameFontSize,
      "font-weight": banner.nameFontWeight,
      color: page.textColor,
    }),
    rule(`${scope} .lg-banner-cta`, {
      background: banner.ctaBackground,
      color: banner.ctaColor,
      "border-radius": banner.ctaRadius,
      "text-transform": banner.ctaTextTransform,
      padding: `${primaryButton.paddingY} ${primaryButton.paddingX}`,
      "text-decoration": "none",
      display: "inline-block",
    }),
  );

  // ---- §8.5 layout containers (08 E4) --------------------------------------
  // Stack: flex column/row via data-direction; align via data-align. The
  // per-instance GAP token value arrives inline from the preset (the
  // --lg-cols idiom) — everything else is class-driven.
  out.push(
    rule(`${scope} .lg-stack`, { display: "flex", "flex-direction": "column" }),
    rule(`${scope} .lg-stack[data-direction="horizontal"]`, {
      "flex-direction": "row",
      "flex-wrap": "wrap",
    }),
    rule(`${scope} .lg-stack[data-align="start"]`, { "align-items": "flex-start" }),
    rule(`${scope} .lg-stack[data-align="center"]`, { "align-items": "center" }),
    rule(`${scope} .lg-stack[data-align="end"]`, { "align-items": "flex-end" }),
    rule(`${scope} .lg-stack[data-align="stretch"]`, { "align-items": "stretch" }),
  );
  // Horizontal stacks collapse to a column on mobile (the §8.11 stacked-
  // buttons behavior) — vertical stacks are unaffected.
  mobile.push(
    rule(`${scope} .lg-stack[data-direction="horizontal"]`, { "flex-direction": "column" }),
  );

  // GridContainer: per-breakpoint columns via the --lg-gc-cols-* custom
  // properties the preset emits inline (desktop at base, mobile inside the
  // mobile media-query array — the iconCardGrid responsive idiom; the tablet
  // count is emitted as --lg-gc-cols-t for the Studio canvas/preview, which
  // renders desktop/mobile viewports only, §8.9). Sizing equal|auto.
  out.push(
    rule(`${scope} .lg-grid-container`, {
      display: "grid",
      "grid-template-columns": "repeat(var(--lg-gc-cols-d, 3), minmax(0, 1fr))",
      "margin-bottom": design.gridContainer.marginBottom,
    }),
    rule(`${scope} .lg-grid-container[data-sizing="auto"]`, {
      "grid-template-columns": "repeat(var(--lg-gc-cols-d, 3), auto)",
      "justify-content": "center",
    }),
  );
  mobile.push(
    rule(`${scope} .lg-grid-container`, {
      "grid-template-columns": "repeat(var(--lg-gc-cols-m, 1), minmax(0, 1fr))",
    }),
    rule(`${scope} .lg-grid-container[data-sizing="auto"]`, {
      "grid-template-columns": "repeat(var(--lg-gc-cols-m, 1), auto)",
    }),
  );

  // Columns: the four §8.5 ratio presets as data-ratio variants; mobile
  // stacking per data-mobile (stack collapses to one column inside the mobile
  // media query; keep preserves the ratio).
  out.push(
    rule(`${scope} .lg-columns`, {
      display: "grid",
      gap: columns.gap,
      "margin-bottom": columns.marginBottom,
    }),
    rule(`${scope} .lg-columns[data-ratio="50/50"]`, { "grid-template-columns": "1fr 1fr" }),
    rule(`${scope} .lg-columns[data-ratio="60/40"]`, { "grid-template-columns": "3fr 2fr" }),
    rule(`${scope} .lg-columns[data-ratio="40/60"]`, { "grid-template-columns": "2fr 3fr" }),
    rule(`${scope} .lg-columns[data-ratio="70/30"]`, { "grid-template-columns": "7fr 3fr" }),
  );
  mobile.push(
    rule(`${scope} .lg-columns[data-mobile="stack"]`, { "grid-template-columns": "1fr" }),
  );

  // CardPanel: centered card shell; the per-instance §8.5 token values
  // (max-width/background/shadow/radius/padding) arrive inline from the
  // preset — the class carries the structural bits + the hairline border.
  out.push(
    rule(`${scope} .lg-card-panel`, {
      width: "100%",
      "margin-left": "auto",
      "margin-right": "auto",
      "box-sizing": "border-box",
      border: cardPanel.border,
    }),
  );

  // BackgroundPanel: token background/gradient inline from the preset; a
  // mediaId image renders as a decorative cover layer behind the content.
  out.push(
    rule(`${scope} .lg-bg-panel`, {
      position: "relative",
      overflow: "hidden",
      padding: backgroundPanel.padding,
      "border-radius": backgroundPanel.radius,
    }),
    rule(`${scope} .lg-bg-panel-img`, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      "object-fit": "cover",
    }),
    rule(`${scope} .lg-bg-panel-inner`, { position: "relative" }),
  );

  // Spacer: block gap; its height token value is inline from the preset.
  out.push(rule(`${scope} .lg-spacer`, { display: "block" }));

  // HeaderBar: placeable header slot (logo / back / secure / CTA) — fully
  // class-driven from the headerBar token group.
  out.push(
    rule(`${scope} .lg-headerbar`, {
      display: "flex",
      "align-items": "center",
      "justify-content": "space-between",
      gap: headerBar.gap,
      "max-width": headerBar.contentMaxWidth,
      "margin-left": "auto",
      "margin-right": "auto",
      background: headerBar.background,
      padding: `${headerBar.paddingY} ${headerBar.paddingX}`,
      "box-shadow": headerBar.boxShadow,
      "box-sizing": "border-box",
    }),
    rule(`${scope} .lg-headerbar-left, ${scope} .lg-headerbar-right`, {
      display: "inline-flex",
      "align-items": "center",
      gap: headerBar.gap,
    }),
    rule(`${scope} .lg-headerbar-logo`, { "max-height": headerBar.logoMaxHeight, width: "auto" }),
    rule(`${scope} .lg-headerbar-secure`, {
      display: "inline-flex",
      "align-items": "center",
      gap: spacing.xs,
      color: headerBar.secureColor,
      "font-size": headerBar.secureFontSize,
    }),
    rule(`${scope} .lg-headerbar-secure-icon`, {
      color: headerBar.secureIconColor,
      "line-height": "1",
    }),
    rule(`${scope} .lg-headerbar-cta`, {
      display: "inline-block",
      background: headerBar.ctaBackground,
      color: headerBar.ctaColor,
      "border-radius": headerBar.ctaRadius,
      "font-size": headerBar.ctaFontSize,
      padding: headerBar.ctaPadding,
      "text-decoration": "none",
      "font-weight": primaryButton.fontWeight,
    }),
  );

  // FooterBar: trust messages / links / legal — fully class-driven from the
  // footerBar token group.
  out.push(
    rule(`${scope} .lg-footerbar`, {
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      gap: footerBar.gap,
      background: footerBar.background,
      "border-top": footerBar.borderTop,
      padding: footerBar.padding,
      "margin-top": footerBar.marginTop,
      "text-align": "center",
    }),
    rule(`${scope} .lg-footerbar-trust`, {
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "center",
      gap: spacing.md,
      color: footerBar.trustColor,
      "font-size": footerBar.trustFontSize,
    }),
    rule(`${scope} .lg-footerbar-links`, {
      display: "flex",
      "flex-wrap": "wrap",
      "justify-content": "center",
      gap: spacing.md,
    }),
    rule(`${scope} .lg-footerbar-link`, {
      color: footerBar.linkColor,
      "font-size": footerBar.fontSize,
      "text-decoration": "underline",
    }),
    rule(`${scope} .lg-footerbar-legal`, {
      color: footerBar.textColor,
      "font-size": footerBar.fontSize,
      "line-height": "1.4",
    }),
  );

  // ---- P1a FIX ROUND (conductor, register PC-3): grid-follower collapse
  // emulation ------------------------------------------------------------
  // LIVE-MEASURED finding: `.lg-answer-group`/`.lg-card-grid` (display:grid)
  // do NOT margin-collapse with an adjoining sibling the way two normal block
  // boxes do — confirmed by a real browser measurement (leadgen-p1-geometry
  // gate): subheadline (margin-bottom 30) followed by the answer-group (the
  // general stack rule's margin-top 18, above) rendered a 48px gap — the SUM
  // of both margins, not max(30,18)=30 like a normal block→block pair (the
  // SAME subheadline→field pair collapses correctly to 30, per r3a-effects —
  // proving the non-collapse is specific to the grid box, not this codebase's
  // margin values in general). The operator's reference shows ~28-30px here,
  // not 48. This table EMULATES the missing collapse — gap == max(predecessor's
  // own margin-bottom, spacing.stack) — for EVERY direct-.lg-question-card-
  // child element that (a) carries a non-zero margin-bottom in this sheet AND
  // (b) can plausibly sit immediately before an answer-group/card-grid, by
  // reducing (or zeroing) the grid follower's margin-top so the SUM equals the
  // desired max(). Enumerated from EVERY non-zero margin-bottom rule in this
  // file, cross-checked against presets.ts's actual render output — verified
  // NOT to include .lg-label/.lg-dropdown-search/.lg-range-value (nested-only,
  // never a direct top-level card child) and .lg-name-group/.lg-range/.lg-input/
  // .lg-field-boxed (real top-level field wrappers — all margin-bottom:0, so
  // no exception is needed: 0 + stack == stack already, the same "sum happens
  // to equal collapse" case as an unset predecessor). `.lg-field` (margin-
  // bottom 16) is included per its LITERAL existence in this sheet even though
  // presets.ts currently renders it ONLY nested inside NameFieldsGroup (never a
  // direct top-level predecessor of a grid) — inert today, harmless, forward-
  // compatible if a future field type ever promotes it to top level.
  //
  // STUDIO-CANVAS WRAPPING (found while verifying this fix with the real
  // browser — leadgen-p1-geometry gate): the studio ISLAND wraps the
  // CURRENTLY-SELECTED choice-bearing node (.lg-answer-group / .lg-card-grid)
  // in an undecorated `<span>` (its move/drag-handle-tag decoration,
  // ui-section-studio.ts — out of this slice's owned region), so a plain
  // adjacent-sibling selector (`X + .lg-answer-group`) does not match: the
  // SPAN, not the grid, is the actual DOM sibling. This ONLY affects whichever
  // node happens to be selected (verified: an unselected card-grid renders as
  // a normal direct child, no wrapper) — but an operator normally DOES have
  // some field selected while editing, so a `:has()` companion selector
  // (`X + *:has(> .lg-answer-group)`) is added alongside every direct-sibling
  // selector below, reaching through that wrapper to give the SAME rhythm
  // whether or not the follower happens to be the selected node. `:has()` is
  // supported by both this repo's Playwright-bundled engines at authoring
  // time (chromium 147 / firefox 148) and by the evergreen browsers these
  // funnels ship to; it changes NOTHING for the (unwrapped) live funnel path,
  // where the base "X + .lg-answer-group" selector alone already matches.
  //
  // Placed LAST in the base sheet (after every per-component rule above,
  // including .lg-continue's own margin-top:26) so it wins any specificity tie
  // for the margin-top property specifically — every OTHER property
  // (.lg-continue's background/width/display, etc.) is untouched.
  {
    // rem-aware px resolver (16px-root assumption — this file's existing
    // convention wherever a rem/px token pair must be compared numerically,
    // e.g. the R7 U12 literal-px conversions elsewhere in this file). BUG
    // CAUGHT BY DIRECT VERIFICATION: a bare `parseFloat("1rem")` returns 1
    // (it stops at the first non-numeric character), NOT 16 — silently
    // mis-scoring every rem-valued predecessor by 15px. spacing.md/trustBar.
    // marginY/logoStrip.marginY/columns.marginBottom are ALL "1rem" tokens.
    const toPx = (value: string): number => {
      const n = parseFloat(value);
      return value.trim().endsWith("rem") ? n * 16 : n;
    };
    const stackPx = toPx(spacing.stack); // 18
    // stack - predecessor's own margin-bottom, floored at 0 (never negative —
    // a predecessor whose own mb already meets/exceeds the stack contributes
    // the WHOLE gap by itself, so the follower's share is 0, not negative).
    const emulated = (predecessorMarginBottom: string): string =>
      `${Math.max(0, stackPx - toPx(predecessorMarginBottom))}px`;
    const GRID_FOLLOWERS = [".lg-answer-group", ".lg-card-grid"] as const;
    // Direct-sibling selectors (the live/unwrapped path) PLUS the `:has()`
    // companion (the studio-canvas selected/wrapped path) for every predecessor
    // + grid-follower pair.
    const followerSelectors = (predecessor: string): string =>
      GRID_FOLLOWERS.flatMap((f) => [
        `${scope} ${predecessor} + ${f}`,
        `${scope} ${predecessor} + *:has(> ${f})`,
      ]).join(", ");
    out.push(
      // Category A — predecessor's own margin-bottom already >= stack: zero
      // the grid follower's margin-top (gap == predecessor's own mb).
      rule(
        [
          followerSelectors(".lg-subheadline"), // mb 30 (golden; conductor part a)
          followerSelectors(".lg-progress"), // mb 32 (2rem)
          followerSelectors(".lg-steps"), // mb 24 (1.5rem)
          followerSelectors(".lg-grid-container"), // mb 24 (1.5rem, GridContainer)
        ].join(", "),
        { "margin-top": "0" },
      ),
      // .lg-card-grid AS PREDECESSOR (mb 24 >= stack): its own margin-bottom
      // already covers the floor for ANY follower type, not just grids — the
      // conductor's part (b). Direct form targets `*` (e.g. multi(.lg-card-
      // grid.lg-multi) -> a plain block, or -> .lg-continue — overriding
      // .lg-continue's own margin-top:26 when it directly follows a card-grid
      // with no field/helper between them; no golden reference pins that
      // specific adjacency, so the card-grid's own established 24 rhythm wins
      // uniformly rather than special-casing Continue here). The `:has()`
      // companion covers a SELECTED card-grid (wrapped) as the predecessor.
      rule([`${scope} .lg-card-grid + *`, `${scope} *:has(> .lg-card-grid) + *`].join(", "), {
        "margin-top": "0",
      }),
      // Category B — predecessor's own margin-bottom < stack: give the grid
      // follower just enough margin-top to reach the stack total (the max()).
      rule(followerSelectors(".lg-headline"), {
        "margin-top": emulated(headline.marginBottom), // 18-9=9
      }),
      rule(followerSelectors(".lg-category"), {
        "margin-top": emulated(categoryLabel.marginBottom), // 18-12=6
      }),
      rule(
        [
          followerSelectors(".lg-trustbar"), // marginY 1rem(16) — TrustBar
          followerSelectors(".lg-logo-strip"), // marginY 1rem(16) — LogoStrip
          followerSelectors(".lg-columns"), // marginBottom 1rem(16) — Columns
          followerSelectors(".lg-field"), // marginBottom 1rem(16) — see note above (currently inert)
        ].join(", "),
        { "margin-top": emulated(spacing.md) }, // 18-16=2 (all four share the SAME 1rem token value)
      ),
    );
  }

  // ---- P1a terminal `[hidden]` guard (register PC — hidden-attribute vs
  // author-display defect) --------------------------------------------------
  // The runtime hides conditionally-shown components by TOGGLING the boolean
  // `hidden` attribute (render.ts applyComponentVisibility / setBackVisible /
  // updateFooterVisibility, plus the SSR-baked `hidden` on the
  // [data-lg-banners] mount, [data-lg-other-panel] and a show_on:"final"
  // footer). The UA sheet's `[hidden]{display:none}` is specificity (0,1,0);
  // EVERY author rule in this sheet carries the scope attribute + at least one
  // class = (0,2,0)+, so it OUTRANKS the UA rule — a hidden component that ALSO
  // has a `display:` rule renders VISIBLE on a live funnel. The live-measured
  // surface (leadgen-live-funnel dependency-HIDE assertion resolved
  // `<div hidden class="lg-answer-group">` yet toBeHidden() saw it visible) and
  // the full cascade audit (leadgen-hidden-visibility.test.ts) found exactly
  // THREE force-visible-when-hidden rules, all at (0,2,0): `.lg-answer-group`
  // (ButtonAnswerGroup / TwoButtonYesNo / OtherGroupSelector, display:grid),
  // `.lg-card-grid` (IconCardAnswerGrid / MultiChoiceCardGroup, display:grid)
  // and `.lg-back` (the Back affordance, display:inline-flex).
  //
  // ONE terminal rule restores the intent at author origin: at the SAME (0,2,0)
  // specificity as every force-visible rule, LATER source order wins, so
  // `hidden` beats `display:grid|inline-flex|flex|block|…` for ANY scoped
  // descendant. The audit confirms NO force-visible display rule on a hideable
  // element exceeds (0,2,0) — every (0,3,0)+ display rule is either
  // `display:none` (reinforcing) or targets a non-hideable element
  // (`.lg-frame-trust`, `.lg-btn-spinner`, the back-icon `span`) — so no
  // higher-specificity companion guard is needed.
  //
  // PLACEMENT: after every base per-component rule (so it wins the source-order
  // tie over all three force-visible rules above) but BEFORE the opt-in
  // frame-region block below, so the frameRegions extension stays a pure APPEND
  // — the no-frame base sheet remains a byte-stable PREFIX of the framed output
  // (the 13 §13.1 invariant leadgen-frame-render.test.ts pins). The frame-region
  // block adds NO force-visible display rule on any hideable class, so nothing
  // after this rule can re-show a hidden component. It only sets `display`, so
  // the grid-follower `margin-top` rules above keep their own last-among-margin
  // precedence untouched. The mobile @media block that follows carries no
  // force-visible display rule on any hideable class either (only `display:none`
  // hides, a root-compound progress `display:flex`, and non-hideable
  // `.lg-frame-trust` layout), so this base rule also wins inside the media
  // query — no mobile duplicate needed (the MOBILE SAFETY case pins this).
  out.push(rule(`${scope} [hidden]`, { display: "none" }));

  // ---- v2.5 frame-region rules (13 §13.1, opt-in — see FunnelChromeCssOpts).
  // Every value is a design token or a role resolved through the §9.1 mapping;
  // the only hand-written bits are structural (positioning/z-index/step sizes
  // around a token midpoint — the existing "44px"/z-index precedent). The two
  // `!important`s exist ONLY to override preset-emitted INLINE token styles
  // (logo img max-height, progress fill background) from a frame class —
  // presets are frozen, so the class rules must outrank the style attribute.
  if (opts?.frameRegions === true) {
    // region stacking: content regions sit above the fixed background layer.
    out.push(
      rule(`${scope} .lg-frame-region`, { position: "relative", "z-index": "1" }),
      rule(`${scope} .lg-frame-background`, {
        position: "fixed",
        inset: "0",
        "z-index": "0",
        "pointer-events": "none",
      }),
    );
    // background role classes — one rule per §9.1 role, resolved from the
    // (possibly themed) design through the SAME role→token mapping.
    for (const role of FUNNEL_TOKEN_ROLES) {
      out.push(
        rule(`${scope} .lg-frame-background.lg-frame-bg-role-${role}`, {
          background: baseTokenForRole(design, role),
        }),
      );
    }
    out.push(
      // brand_gradient resolves via roles (§3.3 — no raw CSS at the config
      // layer); flat/brand use the role class value above.
      rule(`${scope} .lg-frame-background.lg-frame-bg-style-brand_gradient`, {
        background: `linear-gradient(160deg,${baseTokenForRole(design, "brand_primary")},${baseTokenForRole(design, "brand_secondary")})`,
      }),
      rule(`${scope} .lg-frame-bg-img`, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        "object-fit": "cover",
      }),
      // ---- header/logo region --------------------------------------------
      rule(`${scope} .lg-frame-header--static .lg-header`, { position: "static" }),
      rule(`${scope} .lg-frame-header--left .lg-header-inner`, { "justify-content": "flex-start" }),
      rule(`${scope} .lg-frame-header--center .lg-header-inner`, { "justify-content": "center" }),
      // logo sizes: m = the token values; s/l are structural steps around them.
      rule(`${scope} .lg-frame-header--logo-s .lg-logo`, { "font-size": "0.95rem" }),
      rule(`${scope} .lg-frame-header--logo-m .lg-logo`, { "font-size": header.logoFontSize }),
      rule(`${scope} .lg-frame-header--logo-l .lg-logo`, { "font-size": "1.35rem" }),
      rule(`${scope} .lg-frame-header--logo-s .lg-logo-img`, { "max-height": "24px!important" }),
      rule(`${scope} .lg-frame-header--logo-m .lg-logo-img`, {
        "max-height": `${headerBar.logoMaxHeight}!important`,
      }),
      rule(`${scope} .lg-frame-header--logo-l .lg-logo-img`, { "max-height": "44px!important" }),
      rule(`${scope} .lg-frame-header-extras`, {
        background: header.backgroundColor,
        display: "flex",
        "flex-wrap": "wrap",
        "align-items": "center",
        "justify-content": "center",
        gap: spacing.md,
        padding: `0 ${header.paddingX} ${spacing.sm}`,
      }),
      rule(`${scope} .lg-frame-tagline`, {
        margin: "0",
        color: page.textSecondaryColor,
        "font-size": subheadline.fontSize,
      }),
      rule(`${scope} .lg-frame-header-cta`, {
        display: "inline-block",
        background: headerBar.ctaBackground,
        color: headerBar.ctaColor,
        "border-radius": headerBar.ctaRadius,
        "font-size": headerBar.ctaFontSize,
        padding: headerBar.ctaPadding,
        "text-decoration": "none",
        "font-weight": primaryButton.fontWeight,
      }),
      rule(`${scope} .lg-frame-header-disclosure .lg-disclosure-panel`, {
        "font-size": "0.75rem",
        color: page.textSecondaryColor,
      }),
      // ---- progress region -------------------------------------------------
      rule(`${scope} .lg-frame-progress`, {
        "margin-top": spacing.md,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-progress--w-content`, {
        "max-width": content.maxWidth,
        "margin-left": "auto",
        "margin-right": "auto",
      }),
      rule(`${scope} .lg-frame-progress--w-full`, { "max-width": "100%", padding: "0" }),
      // thickness: m = the progress.height token; s/l structural steps.
      rule(`${scope} .lg-frame-progress--th-s .lg-progress-track`, { height: "4px" }),
      rule(`${scope} .lg-frame-progress--th-m .lg-progress-track`, { height: progress.height }),
      rule(`${scope} .lg-frame-progress--th-l .lg-progress-track`, { height: "12px" }),
      rule(`${scope} .lg-frame-progress--no-label .lg-progress-text`, { display: "none" }),
      rule(`${scope} .lg-frame-progress .lg-progress`, { "margin-bottom": "0" }),
      rule(`${scope} .lg-frame-progress .lg-steps`, { "margin-bottom": "0" }),
    );
    // progress color_role classes — the fill is preset-inline (token
    // fillColor), so the frame's role override must win over that style attr.
    for (const role of FUNNEL_TOKEN_ROLES) {
      out.push(
        rule(`${scope} .lg-frame-progress--role-${role} .lg-progress-fill`, {
          background: `${baseTokenForRole(design, role)}!important`,
        }),
      );
    }
    out.push(
      // ---- back region -------------------------------------------------------
      rule(`${scope} .lg-frame-back`, {
        "max-width": content.maxWidth,
        margin: `${spacing.sm} auto 0`,
        padding: `0 ${content.paddingDesktop}`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-back--pos-below_card`, { "text-align": "center" }),
      // style "text": label-only (the preset's arrow span hides).
      rule(`${scope} .lg-frame-back--text .lg-back span[aria-hidden]`, { display: "none" }),
      rule(`${scope} .lg-frame-back--button .lg-back`, {
        background: color.card,
        border: input.border,
        "border-radius": primaryButton.borderRadius,
        padding: `${spacing.sm} ${spacing.md}`,
      }),
      // ---- section slot -------------------------------------------------------
      rule(`${scope} .lg-frame-slot`, {
        width: "100%",
        margin: `${spacing.lg} auto 0`,
        "box-sizing": "border-box",
      }),
      rule(`${scope} .lg-frame-slot--w-s`, { "max-width": cardPanel.widthS }),
      rule(`${scope} .lg-frame-slot--w-m`, { "max-width": cardPanel.widthM }),
      rule(`${scope} .lg-frame-slot--w-l`, { "max-width": cardPanel.widthL }),
      // R7 U12 FIX 3b (conductor ruling, "no double card, both directions"):
      // this class NO LONGER paints a box. The unit-level `.lg-question-card`
      // (base sheet, above) is now the SINGLE SOURCE for the golden card look,
      // reaching frameless AND frame-composed renders identically — so a
      // frame whose OWN section_slot.card config is "card" (the FRAME_TEMPLATES
      // default; frames.ts, out of this file's ownership) must NOT ALSO paint
      // a competing background/border/shadow/padding here, or every default-
      // template funnel would show two nested white boxes. The frame's own
      // card/bare CONFIG PLUMBING is untouched (frame.ts still emits this
      // class name + the 3 --pad-* modifiers unconditionally; a schema/config
      // change is out of scope and out of this file) — only the VISUAL PAINT
      // is removed. `box-sizing` is a harmless, non-painting placeholder that
      // keeps the rule non-empty (styles.ts's rule() helper OMITS an
      // empty-properties rule entirely) so `.lg-frame-slot--card` still
      // appears in the sheet for anything keying on the class's presence
      // (test/leadgen-frame-render.test.ts:523 asserts the string, not a
      // property). The 3 `--pad-{s,m,l}` companions are REMOVED outright (no
      // test references them; their only job was card-interior padding, now
      // owned entirely by `.lg-question-card`'s own golden-exact padding).
      rule(`${scope} .lg-frame-slot--card`, { "box-sizing": "border-box" }),
      rule(`${scope} .lg-frame-slot--off-s`, { "margin-top": spacing.xl }),
      rule(`${scope} .lg-frame-slot--off-m`, { "margin-top": spacing.xxl }),
      // ---- trust strip / benefit bar ------------------------------------------
      rule(`${scope} .lg-frame-trust`, { padding: `0 ${content.paddingDesktop}` }),
      rule(`${scope} .lg-frame-benefit`, {
        background: color.primaryGhost,
        padding: `${spacing.sm} ${content.paddingDesktop}`,
      }),
      // ---- footer region --------------------------------------------------------
      rule(`${scope} .lg-frame-footer-logo`, {
        display: "block",
        margin: `${spacing.md} auto 0`,
        "max-height": logoStrip.logoMaxHeight,
        width: "auto",
      }),
      rule(`${scope} .lg-frame-footer-logo-text`, {
        display: "block",
        "text-align": "center",
        "margin-top": spacing.md,
        "font-family": header.logoFontFamily,
        "font-weight": header.logoFontWeight,
        color: header.logoColor,
      }),
      rule(`${scope} .lg-frame-footer-disclosure`, {
        background: footerBar.background,
        color: validation.helperColor,
        "font-size": "0.75rem",
        "line-height": "1.4",
        "text-align": "center",
        padding: `0 ${footerBar.padding} ${footerBar.padding}`,
      }),
      // ---- disclosure region -----------------------------------------------------
      rule(`${scope} .lg-frame-disclosure--top_bar`, {
        background: color.primaryGhost,
        "border-bottom": `1px solid ${color.borderLight}`,
        "text-align": "center",
        padding: `${spacing.xs} ${content.paddingDesktop}`,
      }),
      rule(`${scope} .lg-frame-disclosure--top_bar .lg-disclosure-panel`, {
        "max-width": content.maxWidth,
        margin: "0 auto",
        "text-align": "left",
        color: page.textSecondaryColor,
        "font-size": "0.75rem",
        padding: `${spacing.xs} 0`,
      }),
      rule(`${scope} .lg-frame-disclosure--modal`, { "text-align": "center", padding: spacing.sm }),
      // §11.4 modal: the SAME disclosure panel markup, overlay-styled (hidden
      // toggle unchanged — no new runtime dependency).
      rule(`${scope} .lg-frame-disclosure--modal .lg-disclosure-panel`, {
        position: "fixed",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        "z-index": "40",
        width: "90%",
        "max-width": cardPanel.widthM,
        background: color.card,
        "border-radius": content.cardRadius,
        "box-shadow": shadow.xl,
        padding: cardPanel.paddingM,
        color: page.textColor,
        "font-size": "0.875rem",
        "text-align": "left",
      }),
      // ---- v2.5 A7: continue-slot rule ----------------------------------------
      // .lg-continue-slot spacing — the §11.5 below_unit end-of-section slot.
      // It stays in THIS frameRegions-gated block on purpose: the slot exists
      // only under a frame's `continue_placement:"below_unit"`, so a legacy
      // funnel never renders it. (The `.lg-card-subtitle`/`.lg-card-badge`
      // choice-depth rules moved to the BASE sheet — DEV-57 Phase C — and the
      // FIX-4a `--lg-sel-bg` consumer followed under DEV-68: both style
      // frame-independent markup, unlike this slot.)
      rule(`${scope} .lg-continue-slot`, {
        // R7 U12: the framed below_unit slot owns the golden :350 26px gap
        // (was spacing.lg=24). The Continue inside it resets its own 26 to 0
        // (next rule) so framed spacing == unframed == 26 with NO double.
        "margin-top": "26px",
        "text-align": "center",
      }),
      rule(`${scope} .lg-continue-slot .lg-continue`, { "margin-top": "0" }),
    );
    // frame mobile behaviors (§3.3 footer.hide_on_mobile + mobile.hide_footer;
    // trust_strip.mobile scroll/hide) — same single media query.
    mobile.push(
      rule(`${scope} .lg-frame-footer--m-hide`, { display: "none" }),
      rule(`${scope} .lg-frame-trust--hide`, { display: "none" }),
      rule(`${scope} .lg-frame-trust--scroll .lg-logo-strip`, {
        "flex-wrap": "nowrap",
        "overflow-x": "auto",
        "justify-content": "flex-start",
      }),
    );

    // ---- §3.3 `mobile` group consumers (DEV-57 B leg) ----------------------
    // Root modifier classes emitted by designs/frame.ts mobileFrameClasses —
    // NOTE the scope CONCATENATION (`${scope}.lg-frame--m-…`): the modifier
    // rides the SAME element as the design-scope attribute (#lg-funnel-root),
    // not a descendant. All rules live in this frameRegions-gated block +
    // the single mobile media query: legacy output stays byte-identical.
    //
    // mobile.logo_size — re-step the header logo at the breakpoint; values
    // mirror the desktop `.lg-frame-header--logo-{s|m|l}` steps exactly (m =
    // tokens, s/l structural). Same-specificity later-rule ordering makes the
    // mobile step win inside the media query (incl. the !important pair that
    // outranks the preset's inline max-height, same as desktop).
    mobile.push(
      rule(`${scope}.lg-frame--m-logo-s .lg-logo`, { "font-size": "0.95rem" }),
      rule(`${scope}.lg-frame--m-logo-m .lg-logo`, { "font-size": header.logoFontSize }),
      rule(`${scope}.lg-frame--m-logo-l .lg-logo`, { "font-size": "1.35rem" }),
      rule(`${scope}.lg-frame--m-logo-s .lg-logo-img`, { "max-height": "24px!important" }),
      rule(`${scope}.lg-frame--m-logo-m .lg-logo-img`, {
        "max-height": `${headerBar.logoMaxHeight}!important`,
      }),
      rule(`${scope}.lg-frame--m-logo-l .lg-logo-img`, { "max-height": "44px!important" }),
      // mobile.trust_strip_mobile — overrides the strip's OWN mode classes at
      // the breakpoint (higher specificity: root modifier + region class).
      // wrap/scroll first restore display (the strip's own mode may be hide).
      rule(`${scope}.lg-frame--m-trust-hide .lg-frame-trust`, { display: "none" }),
      rule(`${scope}.lg-frame--m-trust-wrap .lg-frame-trust`, { display: "block" }),
      rule(`${scope}.lg-frame--m-trust-wrap .lg-frame-trust .lg-logo-strip`, {
        "flex-wrap": "wrap",
        "overflow-x": "visible",
        "justify-content": "center",
      }),
      rule(`${scope}.lg-frame--m-trust-scroll .lg-frame-trust`, { display: "block" }),
      rule(`${scope}.lg-frame--m-trust-scroll .lg-frame-trust .lg-logo-strip`, {
        "flex-wrap": "nowrap",
        "overflow-x": "auto",
        "justify-content": "flex-start",
      }),
    );
    // mobile.progress_position — CSS-only region re-arrangement: the root
    // becomes a flex column at the breakpoint (regions carry top margins
    // only, so no margin-collapse delta) and flex `order` moves the ONE
    // progress region relative to its siblings; the fixed background layer
    // is out of flow. Target semantics:
    //   top          → before the header (disclosure top-bar stays above);
    //   under_header → between header and everything else;
    //   above_unit   → immediately before the section slot;
    //   in_card      → CSS cannot re-parent INTO the slot card — renders as
    //                  above_unit (documented approximation; the true in-card
    //                  mobile mount is the D-phase engine leg).
    // frame.ts never emits these classes when the desktop mount is in_card
    // (inside the slot subtree — unreachable by root-child ordering).
    {
      const mProgress = (pos: string): string => `${scope}.lg-frame--m-progress-${pos}`;
      const preSlotTargets = [mProgress("above_unit"), mProgress("in_card")];
      const postSlotRegions = [
        ".lg-frame-back--pos-below_card",
        ".lg-frame-trust--pos-below_unit",
        ".lg-frame-benefit",
        ".lg-frame-footer",
        ".lg-frame-trust--pos-footer",
        ".lg-frame-back--pos-footer",
        ".lg-frame-disclosure--modal",
      ];
      mobile.push(
        rule(
          ["top", "under_header", "above_unit", "in_card"].map(mProgress).join(","),
          { display: "flex", "flex-direction": "column" },
        ),
        rule(
          `${mProgress("top")} .lg-frame-disclosure--top_bar,${mProgress("under_header")} .lg-frame-disclosure--top_bar`,
          { order: "-3" },
        ),
        rule(
          `${mProgress("top")} .lg-frame-progress,${mProgress("under_header")} .lg-frame-header`,
          { order: "-2" },
        ),
        rule(`${mProgress("under_header")} .lg-frame-progress`, { order: "-1" }),
        rule(
          `${mProgress("above_unit")} .lg-frame-progress,${mProgress("in_card")} .lg-frame-progress`,
          { order: "1" },
        ),
        rule(
          `${mProgress("above_unit")} .lg-frame-slot,${mProgress("in_card")} .lg-frame-slot`,
          { order: "2" },
        ),
        rule(
          preSlotTargets.flatMap((m) => postSlotRegions.map((r) => `${m} ${r}`)).join(","),
          { order: "3" },
        ),
      );
    }
  }

  // ---- assemble: base rules + a single mobile media query -----------------
  const base = out.filter((r) => r !== "").join("\n");
  const mobileCss = mobile.filter((r) => r !== "").join("\n");
  if (mobileCss === "") return base;
  return `${base}\n@media (max-width: ${breakpoints.mobileMax}){\n${mobileCss}\n}`;
}
