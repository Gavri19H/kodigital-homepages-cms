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
      width: "100%",
      "max-width": primaryButton.maxWidth,
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
      background: color.card,
      color: page.textColor,
      border: input.border,
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
      "border-radius": iconCard.borderRadius,
      background: iconCard.background,
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
    rule(`${scope} .lg-card-icon`, {
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
    // the input clears it with token-derived left padding.
    rule(`${scope} .lg-currency`, { position: "relative" }),
    rule(`${scope} .lg-currency-prefix`, {
      position: "absolute",
      left: input.padding,
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
      rule(`${scope} .lg-frame-slot--card`, {
        background: color.card,
        border: cardPanel.border,
        "border-radius": content.cardRadius,
        "box-shadow": shadow.md,
      }),
      rule(`${scope} .lg-frame-slot--card.lg-frame-slot--pad-s`, { padding: cardPanel.paddingS }),
      rule(`${scope} .lg-frame-slot--card.lg-frame-slot--pad-m`, { padding: cardPanel.paddingM }),
      rule(`${scope} .lg-frame-slot--card.lg-frame-slot--pad-l`, { padding: cardPanel.paddingL }),
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
  }

  // ---- assemble: base rules + a single mobile media query -----------------
  const base = out.filter((r) => r !== "").join("\n");
  const mobileCss = mobile.filter((r) => r !== "").join("\n");
  if (mobileCss === "") return base;
  return `${base}\n@media (max-width: ${breakpoints.mobileMax}){\n${mobileCss}\n}`;
}
