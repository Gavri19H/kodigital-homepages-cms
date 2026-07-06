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

// tokens → the full scoped chrome stylesheet for one funnel design. `scope`
// defaults to the default-funnel scope; a different design passes its own.
export function funnelChromeCss(
  design: DefaultFunnelDesign,
  scope: string = DEFAULT_FUNNEL_SCOPE,
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
    iconCardGrid,
    iconCard,
    input,
    dropdown,
    validation,
    transitions,
    breakpoints,
    banner,
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
    // Continue is the full-width centred pill (§14.6): navy, NOT blue.
    rule(`${scope} .lg-continue`, {
      width: "100%",
      "max-width": primaryButton.maxWidth,
      "margin-left": "auto",
      "margin-right": "auto",
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

  // ---- assemble: base rules + a single mobile media query -----------------
  const base = out.filter((r) => r !== "").join("\n");
  const mobileCss = mobile.filter((r) => r !== "").join("\n");
  if (mobileCss === "") return base;
  return `${base}\n@media (max-width: ${breakpoints.mobileMax}){\n${mobileCss}\n}`;
}
