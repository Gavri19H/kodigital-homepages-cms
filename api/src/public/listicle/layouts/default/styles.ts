// Default listicle layout — the FULL page stylesheet (contract §30.1/§30.2 +
// register DEV-13: today's live reference wins where the drift register
// carries both values).
//
// Composition (§14 "tokens, not hardcode"):
//   1. `defaultLayoutSectionCss()` from tokens-to-css.ts is the CORE — the
//      §30.6 section-content stylesheet generated from tokens.
//   2. Chrome groups (header / logo / Disclosure / title / byline / hero /
//      intro / legal band / footer) are generated from the SAME token groups
//      via the exported `tokenGroupCss` mapper, with the 2026-07-03 measured
//      drift values substituted through measured-values.ts (each one
//      evidence-checked against the tokens.ts prose by unit test).
//   3. The O3 fix: the inter-section rhythm is a REAL `<hr class="lst-divider">`
//      element whose margins come from tokens.sectionWrapper.measured — the
//      section wrapper itself carries the measured 0 margins.
// No CSS value in this module is hand-written where a measured token exists.

import {
  curatedColorCss,
  defaultLayoutSectionCss,
  tokenGroupCss,
  DEFAULT_LAYOUT_SCOPE,
} from "./tokens-to-css";
import { defaultListicleLayoutTokens } from "./tokens";
import {
  DRIFT_OVERRIDES_2026_07_03,
  DISCLOSURE_PANEL,
  DISCLOSURE_PANEL_STYLE,
  SECTION_DIVIDER,
  SECTION_HEADING_WRAPPER,
  SECTION_HEADING_LG,
  HEADING_NUMBER_BADGE,
  SECTION_IMAGE_GAPS,
  BUTTON_GROUP_GRID,
  GROUP_FOLLOWUP_CTA,
  LEGAL_BAND,
  FOOTER_MEASURED,
  LG_BREAKPOINT_PX,
} from "./measured-values";
import {
  LISTICLE_TEXT_COLORS,
  LISTICLE_HIGHLIGHTS,
} from "../../../../editor/listicle-blocks";

const T = defaultListicleLayoutTokens;
const D = DRIFT_OVERRIDES_2026_07_03;

function v(entry: { values: Readonly<Record<string, string>> }, key: string): string {
  const value = entry.values[key];
  if (value === undefined) {
    throw new Error(`measured-values: missing key '${key}'`);
  }
  return value;
}

// §14 cssVars — the effective (drift-resolved) top-level identity of the
// default layout, exposed as CSS custom properties on the layout scope.
export function defaultLayoutCssVars(): Record<string, string> {
  return {
    "--lst-font-family": v(D.pageFontFamily!, "fontFamily"),
    "--lst-page-bg": T.page.backgroundColor,
    "--lst-page-color": T.page.textColor,
    "--lst-header-bg": v(D.headerBackground!, "backgroundColor"),
    "--lst-cta-bg": T.choiceButton.backgroundColor,
    "--lst-link-color": T.inlineLink.color,
    "--lst-footer-bg": T.footer.backgroundColor,
  };
}

// The complete stylesheet for the public listicle page.
export function defaultLayoutCss(scope: string = DEFAULT_LAYOUT_SCOPE): string {
  const out: string[] = [];
  const mobile639: string[] = []; // <640px — the measured headline/footer breakpoint
  const min768: string[] = []; // ≥768px (md:)
  const lg: string[] = []; // ≥1024px (lg:)

  const emit = (
    selector: string,
    group: Record<string, unknown>,
    options?: { only?: ReadonlyArray<string>; overrides?: Readonly<Record<string, string>> },
    mobileBucket: string[] = mobile639,
  ): void => {
    const { base, mobile } = tokenGroupCss(selector, group, options);
    if (base !== "") out.push(base);
    if (mobile !== "") mobileBucket.push(mobile);
  };

  // ---- 0. document reset + cssVars ---------------------------------------
  out.push("html,body{margin:0;padding:0}");
  const vars = Object.entries(defaultLayoutCssVars())
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  out.push(`${scope}{${vars}}`);

  // ---- 1. the §30.6 section-content CORE (tokens-to-css) -----------------
  out.push(defaultLayoutSectionCss(scope));
  out.push(curatedColorCss({ textColors: LISTICLE_TEXT_COLORS, highlights: LISTICLE_HIGHLIGHTS }, scope));

  // ---- 2. drift overrides over core-emitted groups (DEV-13) --------------
  // Page font: live Inter (Arial-metric fallback).
  out.push(`${scope}{font-family:${v(D.pageFontFamily!, "fontFamily")}}`);
  // Body paragraphs (drift: 18px/30px, margins 0 + 6px paddings; in-section
  // copy #2c2c2c). The core emitted the §30.1 baseline (20px/mb15) — these
  // later rules win the cascade at equal specificity.
  const para = D.bodyParagraph!;
  out.push(
    `${scope} .lst-section p{font-size:${v(para, "fontSize")};line-height:${v(para, "lineHeight")};color:${v(para, "sectionColor")};margin:${v(para, "margin")};padding-top:${v(para, "paddingY")};padding-bottom:${v(para, "paddingY")}}`,
  );

  // ---- 3. header (§30.2 ListicleHeader) -----------------------------------
  emit(`${scope} .lst-header`, T.header, {
    only: [
      "height",
      "backgroundColor",
      "paddingX",
      "paddingY",
      "display",
      "alignItems",
      "justifyContent",
      "boxSizing",
    ],
    overrides: {
      backgroundColor: v(D.headerBackground!, "backgroundColor"),
      paddingX: v(D.headerPaddingX!, "paddingX"),
    },
  });
  // Drift: live header has NO border-bottom.
  out.push(
    `${scope} .lst-header{border-bottom:${v(D.headerBorderBottom!, "borderBottomWidth")} solid ${v(D.headerBorderBottom!, "borderBottomColor")}}`,
  );

  // HostLogo — the ONLY per-host brand swap (§30.3). Drift: h-10 w-auto
  // (40px fixed height, intrinsic-ratio width).
  out.push(
    `${scope} .lst-logo{display:flex;align-items:center;min-width:0}`,
    `${scope} .lst-logo img{height:${v(D.logoSlot!, "height")};width:${v(D.logoSlot!, "width")};display:block;object-fit:${T.logoSlot.objectFit};object-position:${T.logoSlot.objectPosition}}`,
    // No-logo fallback: the site name in white (same slot geometry).
    `${scope} .lst-logo .lst-logo-text{color:#ffffff;font-weight:700;font-size:20px;line-height:${v(D.logoSlot!, "height")};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
  );

  // ---- 4. Disclosure (measured dropdown panel, §31.0 blocker 2) ----------
  out.push(`${scope} .lst-disclosure{position:relative;z-index:10}`);
  emit(`${scope} .lst-disclosure-trigger`, T.disclosureTrigger, {
    only: ["color", "fontWeight", "lineHeight", "textDecoration", "cursor"],
  });
  out.push(
    `${scope} .lst-disclosure-trigger{font-size:${v(D.disclosureTriggerFontSize!, "fontSize")};background:none;border:0;padding:0;font-family:inherit}`,
  );
  lg.push(
    `${scope} .lst-disclosure-trigger{font-size:${v(D.disclosureTriggerFontSize!, "fontSizeLg")}}`,
  );
  // Panel: 288px white dropdown below the trigger, right-aligned, 8px offset,
  // radius 4, shadow-lg, 16px padding, black 16/24 text; no animation.
  out.push(
    `${scope} .lst-disclosure-panel{display:none;position:${v(DISCLOSURE_PANEL, "position")};top:calc(100% + ${v(DISCLOSURE_PANEL, "topOffset")});right:${v(DISCLOSURE_PANEL, "right")};width:${DISCLOSURE_PANEL_STYLE.width};background-color:${DISCLOSURE_PANEL_STYLE.backgroundColor};color:${DISCLOSURE_PANEL_STYLE.color};font-size:${DISCLOSURE_PANEL_STYLE.fontSize};line-height:${DISCLOSURE_PANEL_STYLE.lineHeight};padding:${DISCLOSURE_PANEL_STYLE.padding};border-radius:${DISCLOSURE_PANEL_STYLE.borderRadius};box-shadow:${DISCLOSURE_PANEL_STYLE.boxShadow};text-align:left}`,
    `${scope} .lst-disclosure-panel.lst-open{display:block}`,
  );

  // ---- 5. ArticleShell: top spacing + title + byline + hero + intro ------
  emit(`${scope} .lst-article-shell`, T.articleTopSpacing, {
    only: ["paddingTopDesktop", "paddingTopMobile"],
  });

  // Title — the MEASURED two-line heading pattern (drift register `headline`):
  // stacked heading lines, 36px/40px + 4px padding-y, w700 via <strong>,
  // centered, no max-width, margins 0. Mobile (<640px): 24px/32px (tokens
  // articleHeadline *Mobile direct fields).
  const H = D.headline!;
  out.push(
    `${scope} .lst-title{text-align:${T.articleHeadline.textAlign};color:${T.articleHeadline.color}}`,
    `${scope} .lst-title .lst-title-line{font-size:${v(H, "fontSize")};line-height:${v(H, "lineHeight")};font-weight:${v(H, "fontWeight")};letter-spacing:${v(H, "letterSpacing")};max-width:${v(H, "maxWidth")};margin:${v(H, "margin")};padding-top:${v(H, "paddingY")};padding-bottom:${v(H, "paddingY")}}`,
  );
  mobile639.push(
    `${scope} .lst-title .lst-title-line{font-size:${T.articleHeadline.fontSizeMobile};line-height:${T.articleHeadline.lineHeightMobile}}`,
  );

  // Byline (§30.2) — drift: avatar 30px, 12px/18px w600 #4b5563.
  const B = D.byline!;
  emit(`${scope} .lst-byline`, T.byline, {
    only: ["display", "alignItems", "justifyContent", "gap", "marginBottom"],
  });
  out.push(
    `${scope} .lst-byline{font-size:${v(B, "fontSize")};line-height:${v(B, "lineHeight")};font-weight:${v(B, "fontWeight")};color:${v(B, "color")}}`,
    `${scope} .lst-byline .lst-byline-avatar{width:${v(B, "avatarSize")};height:${v(B, "avatarSize")};border-radius:${T.byline.avatarRadius};object-fit:cover;display:block}`,
  );

  // Hero — drift: radius 8px, img margins 0; the 16px visual gap below is
  // wrapper 10px + the intro paragraph's 6px top padding.
  emit(`${scope} .lst-hero img`, T.heroImage, {
    only: ["width", "aspectRatio", "objectFit", "objectPosition", "display"],
  });
  out.push(
    `${scope} .lst-hero img{border-radius:${v(D.hero!, "borderRadius")};margin:${v(D.hero!, "margin")};height:auto}`,
    `${scope} .lst-hero{margin:0 0 ${v(D.hero!, "wrapperMarginBottom")} 0}`,
  );

  // Intro paragraphs (drift: 18px/30px #333333, margins 0 + 6px paddings).
  out.push(
    `${scope} .lst-intro p{font-family:inherit;font-size:${v(para, "fontSize")};line-height:${v(para, "lineHeight")};font-weight:400;color:${v(para, "introColor")};margin:${v(para, "margin")};padding-top:${v(para, "paddingY")};padding-bottom:${v(para, "paddingY")}}`,
  );

  // ---- 6. sections: divider (O3), linked heading + badge, image gaps -----
  // O3: the inter-section rhythm is a REAL <hr> divider; margins live on the
  // hr (tokens.sectionWrapper.measured), the wrapper itself is margin-0.
  out.push(
    `${scope} .lst-divider{border:0;height:${v(SECTION_DIVIDER, "height")};background-color:${v(SECTION_DIVIDER, "color")};margin:${v(SECTION_DIVIDER, "marginTop")} 0 ${v(SECTION_DIVIDER, "marginBottom")} 0}`,
  );

  // Linked section heading: h3 wrapped in <a>; wrapper pt 4px / mb 8px;
  // hover underline + #374151; the numbered badge span.
  out.push(
    `${scope} .lst-heading-wrap{padding-top:${v(SECTION_HEADING_WRAPPER, "paddingTop")};margin-bottom:${v(SECTION_HEADING_WRAPPER, "marginBottom")}}`,
    `${scope} .lst-heading-wrap a{color:inherit;text-decoration:none}`,
    `${scope} .lst-heading-wrap a:hover{text-decoration:underline;color:${v(SECTION_HEADING_WRAPPER, "hoverColor")}}`,
    `${scope} .lst-heading-badge{background-color:${v(HEADING_NUMBER_BADGE, "backgroundColor")};padding-left:${v(HEADING_NUMBER_BADGE, "paddingX")};padding-right:${v(HEADING_NUMBER_BADGE, "paddingX")};border-radius:${v(HEADING_NUMBER_BADGE, "borderRadius")};display:${v(HEADING_NUMBER_BADGE, "display")};margin-right:${v(HEADING_NUMBER_BADGE, "marginRight")};line-height:${v(HEADING_NUMBER_BADGE, "lineHeight")}}`,
  );
  lg.push(
    `${scope} .lst-heading-badge{line-height:${v(HEADING_NUMBER_BADGE, "lineHeightLg")}}`,
    // §31.0 lg: heading variant (27.2px/40.8px at ≥1024px).
    `${scope} .lst-section h2, ${scope} .lst-section h3{font-size:${v(SECTION_HEADING_LG, "fontSize")};line-height:${v(SECTION_HEADING_LG, "lineHeight")}}`,
  );

  // Section image rhythm: 8px below the heading comes from the heading
  // wrapper's margin; 16px visual gap to the paragraph = wrapper 10px +
  // paragraph 6px top padding.
  out.push(
    `${scope} .lst-section .lst-img{margin:0 0 ${v(SECTION_IMAGE_GAPS, "wrapperMarginBottom")} 0}`,
    `${scope} .lst-section .lst-img img{height:auto}`,
  );

  // ---- 7. choice groups: measured GRID columns + follow-up CTA rhythm ----
  const G = BUTTON_GROUP_GRID;
  out.push(
    `${scope} .lst-choice-group{grid-template-columns:repeat(${v(G, "defaultColumns")},minmax(0,1fr))}`,
    `${scope} .lst-choice-group[data-lst-cols="2"]{grid-template-columns:repeat(${v(G, "evenColumns")},minmax(0,1fr))}`,
    // The group prompt spans the full grid row.
    `${scope} .lst-choice-group .lst-choice-prompt{grid-column:1 / -1}`,
  );
  lg.push(
    `${scope} .lst-choice-group{grid-template-columns:repeat(${v(G, "defaultColumnsLg")},minmax(0,1fr))}`,
    `${scope} .lst-choice-group[data-lst-cols="2"]{grid-template-columns:repeat(${v(G, "evenColumns")},minmax(0,1fr))}`,
  );
  // Follow-up CTA row after a group (measured my-2 → 8px above/below).
  out.push(
    `${scope} .lst-btn-row{margin-top:${v(GROUP_FOLLOWUP_CTA, "marginY")};margin-bottom:${v(GROUP_FOLLOWUP_CTA, "marginY")}}`,
  );

  // ---- 8. candidate machinery (§22.4) -------------------------------------
  out.push(
    // All candidates hidden by default; the per-page inline <style> marks the
    // DEFAULT candidate visible (interim single_default — Phase 7 selector).
    `${scope} .lst-cand{display:none}`,
    // Lazy-hydration placeholder reserves its box (zero CLS on swap).
    `${scope} .lst-cand-pending{display:block}`,
  );

  // ---- 9. legal disclosure band -------------------------------------------
  out.push(
    `${scope} .lst-legal-band{display:${v(LEGAL_BAND, "display")};justify-content:${v(LEGAL_BAND, "justifyContent")};padding-top:${v(LEGAL_BAND, "paddingY")};padding-bottom:${v(LEGAL_BAND, "paddingY")};background-color:${T.page.backgroundColor}}`,
  );

  // ---- 10. footer (measured near-black band) ------------------------------
  const F = FOOTER_MEASURED;
  out.push(
    `${scope} .lst-footer{background-color:${T.footer.backgroundColor};border-top:${T.footer.borderTopWidth} solid ${T.footer.borderTopColor}}`,
    `${scope} .lst-footer-inner{width:100%;max-width:${v(F, "innerMaxWidth")};margin:0 auto;padding:${v(F, "innerPaddingY")} ${v(F, "innerPaddingX")};box-sizing:border-box}`,
    `${scope} .lst-footer-top{display:block}`,
    `${scope} .lst-footer-logo{display:inline-block}`,
    `${scope} .lst-footer-logo img{height:${T.footer.footerLogoHeight};width:auto;display:block}`,
    `${scope} .lst-footer-logo .lst-logo-text{color:${T.footer.linkColor};font-weight:700;font-size:20px;line-height:${T.footer.footerLogoHeight};display:block}`,
    `${scope} .lst-footer-nav{list-style:none;display:flex;flex-wrap:wrap;margin:0 0 ${v(F, "navListMarginBottom")} 0;padding:0}`,
    `${scope} .lst-footer-nav a{color:${T.footer.linkColor};font-size:${T.footer.linkFontSize};line-height:${T.footer.linkLineHeight};font-weight:${T.footer.linkFontWeight};text-decoration:${T.footer.linkTextDecoration};margin-right:${v(F, "navLinkGapSm")}}`,
    `${scope} .lst-footer-nav a:hover{text-decoration:${T.footer.linkHoverTextDecoration}}`,
    `${scope} .lst-footer-divider{border:0;border-top:1px solid ${v(F, "dividerColor")};margin:${v(F, "dividerMarginY")} 0}`,
    `${scope} .lst-footer-legal{font-size:${T.footer.legalFontSize};line-height:${T.footer.legalLineHeight};color:${T.footer.legalColor};margin:${T.footer.legalMarginTop} 0 ${v(F, "legalMarginBottom")} 0;text-align:${v(F, "legalTextAlign")}}`,
    `${scope} .lst-footer-copyright{font-size:${T.footer.copyrightFontSize};line-height:${T.footer.copyrightLineHeight};color:${T.footer.copyrightColor};margin:${T.footer.copyrightMarginTop} 0 0 0;padding-bottom:${v(F, "copyrightPaddingBottom")}}`,
    // The header logo (white asset) reused in the footer at h-10 w-auto —
    // the same 232.7×40 slot geometry as the header (§30.1 footer.measured.logo).
    `${scope} .lst-footer-logo{margin-bottom:${T.footer.footerLogoMarginBottom}}`,
  );
  // ≥640px: footer row layout (logo left / nav right), logo margin 0.
  min768.push(
    `${scope} .lst-footer-inner{padding-top:${v(F, "innerPaddingYMd")};padding-bottom:${v(F, "innerPaddingYMd")}}`,
    `${scope} .lst-footer-nav a{margin-right:${v(F, "navLinkGap")}}`,
  );
  out.push(
    `@media (min-width: 640px){${scope} .lst-footer-top{display:flex;align-items:center;justify-content:space-between}${scope} .lst-footer-logo{margin-bottom:0}${scope} .lst-footer-nav{margin-bottom:0}}`,
  );
  lg.push(
    `${scope} .lst-footer-divider{margin:${v(F, "dividerMarginYLg")} 0}`,
    `${scope} .lst-footer-copyright{padding-bottom:${v(F, "copyrightPaddingBottomLg")}}`,
  );

  // ---- assemble ------------------------------------------------------------
  const css = out.filter((r) => r !== "").join("\n");
  const parts = [css];
  if (mobile639.length > 0) {
    parts.push(`@media (max-width: 639px){\n${mobile639.join("\n")}\n}`);
  }
  if (min768.length > 0) {
    parts.push(`@media (min-width: 768px){\n${min768.join("\n")}\n}`);
  }
  if (lg.length > 0) {
    parts.push(`@media (min-width: ${LG_BREAKPOINT_PX}px){\n${lg.join("\n")}\n}`);
  }
  return parts.join("\n");
}
