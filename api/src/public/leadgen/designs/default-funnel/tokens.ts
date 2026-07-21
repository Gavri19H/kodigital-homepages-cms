// LeadGen VISUAL DESIGN — "default-funnel" (default funnel visual design).
// Target: api/src/public/leadgen/designs/default-funnel/tokens.ts
// Measured 1:1 from the reference funnel stylesheet. Visual design only; SEPARATE
// from the component capability registry. No banned product name in source.
//
// P6 THEME v2 (D-7) — the DISPLAY vs BODY font-slot split (deliverable 2), made
// explicit so the theme display/body ramp wiring (theme.ts applyDisplayFont /
// applyBodyFont + scaleDisplayFontSizes) is legible at the token layer. These
// are the ONLY font-family / display-font-size slots the theme layer touches;
// no NEW token key is added here — a new key would change the serialized
// `design_tokens` bytes and break the A0 legacy config byte-pin, so P6's
// display ramp scales these EXISTING slots and its button-style looks reuse the
// existing radius/shadow/colour scales (see designs/theme.ts + styles.ts):
//   DISPLAY family slots (headline voice): page.fontDisplay, header.logoFontFamily,
//     headline.fontFamily, rangeQuestion.valueFontFamily, successState.headingFontFamily
//   DISPLAY size slots (the display_size ramp scales these): headline.fontSizeDesktop,
//     headline.fontSizeMobile, header.logoFontSize, rangeQuestion.valueFontSize,
//     successState.headingFontSize
//   BODY family slots (paragraph voice): page.fontFamily, primaryButton.fontFamily
// (The base design's own families — 'Sora'/'Literata'/'Newsreader' — are NOT in
// the P6 self-hosted set, so a legacy funnel emits no @font-face and renders
// byte-identically; a theme opts into a self-hosted family per-funnel.)
export const defaultFunnelDesign = {
  id: "default-funnel", source: "reference funnel stylesheet (measured)",
  page:{backgroundColor:"#F5F7FA",textColor:"#1A1F36",textSecondaryColor:"#4A5568",textLightColor:"#718096",fontFamily:"'Sora',system-ui,Arial,sans-serif",fontDisplay:"'Literata',Georgia,serif",minHeight:"100vh"},
  color:{primary:"#1B3A5C",primaryDark:"#0F2440",primaryLight:"#2A5080",accent:"#E85D26",accentHover:"#D14E1C",card:"#FFFFFF",border:"#D2D9E5",borderLight:"#E8ECF2",success:"#0E7C3A",error:"#D32F2F",primaryWash:"#E8EEF4",primaryGhost:"#F2F6FA",accentLight:"#FEF0EB",recommendedBg:"#FFFAF7",recommendedBorder:"#E85D26",recommendedGlow:"rgba(232,93,38,0.12)"},
  // P1a inter-component rhythm (register PC-3): `stack` is the section-unit's
  // vertical rhythm FLOOR — the gap `.lg-question-card > * + *` puts between
  // EVERY adjacent component (styles.ts). 18px sits deliberately between md
  // (16) and lg (24): comfortable breathing room that is STILL ≤ the golden's
  // own larger inter-component gaps (sub→field 30, helper→Continue 26) so
  // margin-collapse leaves those exact, while the golden's ONE tighter gap
  // (headline→sub 9px) is preserved by the subheadline's own margin-top:0
  // winning the cascade over this floor (styles.ts source-order note). Literal
  // px (not rem) so a host zone's non-16px root can never drift the rhythm —
  // same precedent as headline.fontSizeDesktop. stackMobile scales it down for
  // the sub-480 card interior.
  spacing:{xs:"0.25rem",sm:"0.5rem",md:"1rem",lg:"1.5rem",xl:"2rem",xxl:"3rem",stack:"18px",stackMobile:"12px"},
  radius:{sm:"6px",md:"10px",lg:"14px",xl:"20px",full:"9999px"},
  shadow:{sm:"0 1px 3px rgba(27,58,92,.06)",md:"0 4px 8px rgba(27,58,92,.06)",lg:"0 8px 24px rgba(27,58,92,.08)",xl:"0 16px 48px rgba(27,58,92,.10)",glow:"0 8px 32px rgba(232,93,38,.12)"},
  header:{backgroundColor:"#FFFFFF",paddingY:"1rem",paddingX:"1.5rem",contentMaxWidth:"600px",align:"center",boxShadow:"0 1px 3px rgba(27,58,92,.06)",position:"sticky",logoFontFamily:"'Literata',serif",logoFontSize:"1.1rem",logoFontWeight:"700",logoColor:"#1B3A5C",logoAccentColor:"#E85D26"},
  backButton:{kind:"text",color:"#718096",fontSize:"0.875rem",hoverColor:"#1B3A5C"},
  disclosure:{color:"#718096",fontSize:"0.8rem",hoverColor:"#1B3A5C"},
  // R7 U11b/U12 FIX (conductor-ruled 2026-07-15): the live content column
  // width 500→600, matching the golden's OWN composition column (golden-
  // master-source.dc.html :296 `width:600px`, with the white question card
  // :308 nested directly inside it) and contract §7.1 ("the demo value 384
  // = 64% of the 600 column"; custom-px clamp [200,600]). The pre-golden 500
  // was legacy: the golden-exact card padding (46px/side, negative-margin-
  // cancelled onto the column's full border-box — styles.ts :187-198) left a
  // 500 column with only a 408px interior, too narrow for the L width preset
  // (480px) to center (browser-measured 37px off-center, reproducible). At
  // 600 the interior is 508px and all of s/m/l center within ≤1px. MOBILE IS
  // UNAFFECTED: the mobile `.lg-content` rule (styles.ts :163) overrides ONLY
  // `padding`, never `max-width`, so any sub-600 viewport stays viewport-
  // capped exactly as before (the max-width only ever binds above 600px).
  // The sibling `header.contentMaxWidth` (:12) is already 600 (gate-3's unit
  // column, leadgen-v31-gate3-geometry.test.ts) — the two now agree, as the
  // golden's single 600 column intends.
  content:{maxWidth:"600px",offersMaxWidth:"420px",paddingDesktop:"1.5rem",paddingMobile:"1rem",cardPadding:"24px 20px",cardRadius:"14px"},
  // R7 U12 FIX 3b (golden :308, conductor-ruled 2026-07-15): the white
  // question card — the section-unit's DEFAULT composition (studio canvas +
  // live/preview, both framed and frameless — see presets.ts renderQuestionCard).
  // Every value is the golden's OWN literal (golden :308 inline style:
  // "background:#fff;border-radius:16px;box-shadow:0 8px 28px
  // rgba(20,32,54,.10);border:1px solid #E9EDF3;padding:44px 46px 40px") —
  // deliberately NOT reusing the pre-existing `content.cardPadding`/
  // `cardRadius`/`color.card`/`shadow.*` tokens (24px 20px / 14px / a
  // different shadow recipe): those tokens serve OTHER existing consumers
  // (the frame's own pre-golden card look, banner cards, etc.) that this
  // deliverable does not touch — a new, golden-exact, dedicated token group,
  // same "literal px matching the mockup byte-for-byte" precedent as the R5
  // D11 headline typography grant above. paddingMobile is FLAGGED, not
  // golden-sourced: the golden mockup is DESKTOP-ONLY (1440x944, same
  // no-mobile-spec gap as headline.fontSizeMobile above) — scaled sensibly
  // (roughly proportional to the existing content.paddingMobile/paddingDesktop
  // ratio) and recorded here as an explicit erratum for conductor/operator
  // confirmation, not asserted as a contract fact.
  questionCard:{background:"#FFFFFF",border:"1px solid #E9EDF3",borderRadius:"16px",boxShadow:"0 8px 28px rgba(20,32,54,.10)",paddingDesktop:"44px 46px 40px",paddingMobile:"28px 20px 24px"},
  progress:{height:"8px",trackColor:"#E8EEF4",fillColor:"linear-gradient(90deg,#1B3A5C,#2A5080)",borderRadius:"9999px",textColor:"#1B3A5C",marginBottom:"2rem"},
  // R5 D11 (register S4-B2, operator decision 1 — RESOLVED "YES, match the
  // approved design"): headline typography now matches the golden mockup
  // byte-for-byte (golden :312 "font-family:Newsreader,serif;font-size:31px;
  // line-height:1.15;font-weight:600;color:#16324f"). fontSizeDesktop is a
  // literal px (breaking this file's OWN rem convention deliberately) — a
  // rem value would drift if a host zone's root font-size ever differs from
  // 16px, and these funnels embed on 100+ zones outside this codebase's
  // control; golden's OWN mockup styles use a literal px for this exact
  // property too. fontSizeMobile is UNCHANGED (golden's mockup is desktop-
  // only, 1440x944 — no mobile value is specified anywhere to match against;
  // ONLY-INTENDED-DELTA discipline means this phase changes nothing golden
  // doesn't say to). header.logoFontFamily / rangeQuestion.valueFontFamily
  // (both also 'Literata') are UNTOUCHED — the dispatch scopes this
  // deliverable to the question headline only.
  // R7 U12 (operator retest — "default gaps don't exist/match"): headline→
  // subheadline gap = golden :313's 9px (the golden puts it on the sub's
  // margin-top; the flat-node renderer emits the identical rendered gap via the
  // headline's own margin-bottom — the element that precedes the subheadline).
  headline:{fontFamily:"'Newsreader',serif",fontSizeDesktop:"31px",fontSizeMobile:"1.375rem",fontWeight:"600",lineHeight:"1.15",color:"#16324f",textAlign:"center",marginBottom:"9px"},
  // subheadline.color matches golden :313 (#63707F). subheadline.fontSize
  // stays THE SHARED 0.825rem token deliberately — golden's 15px applies
  // ONLY to the question-card subheadline; this SAME token also feeds
  // .lg-card-desc (icon-card choice descriptions, styles.ts) and other
  // non-question-headline consumers this deliverable does not touch. The
  // question-card-specific 15px override lives as a SURGICAL styles.ts rule
  // instead (conductor-ratified — "the shared token feeding .lg-card-desc
  // stays untouched — correct blast-radius discipline").
  // R7 U12: subheadline→field gap = golden :912-914's fieldWrapStyle
  // margin-top:30px. The golden hangs it on the field wrapper; the flat-node
  // renderer emits the identical rendered gap via the subheadline's own
  // margin-bottom (the element that immediately precedes the field). margin
  // 20→30. subheadline.fontSize stays the shared 0.825rem token (the surgical
  // 15px card override lives in styles.ts — unchanged).
  subheadline:{fontSize:"0.825rem",color:"#63707F",textAlign:"center",marginBottom:"30px"},
  categoryLabel:{fontSize:"0.8125rem",fontWeight:"700",letterSpacing:"2px",textTransform:"uppercase",color:"#E85D26",marginBottom:"12px"},
  rangeQuestion:{valueFontFamily:"'Literata',serif",valueFontSize:"2.25rem",valueFontWeight:"700",valueColor:"#1A1F36",trackHeight:"8px",trackRadius:"9999px",filledTrackColor:"#1B3A5C",unfilledTrackColor:"#E8EEF4",thumbSize:"28px",thumbBorder:"3px solid #FFFFFF",thumbBackground:"#1B3A5C",thumbShadow:"0 2px 8px rgba(27,58,92,.25)",minMaxLabelColor:"#718096"},
  primaryButton:{background:"#1B3A5C",color:"#FFFFFF",paddingY:"14px",paddingX:"16px",minHeight:"52px",maxWidth:"320px",widthMobile:"100%",borderRadius:"10px",hoverBackground:"#0F2440",disabledOpacity:"0.6",fontFamily:"'Sora',sans-serif",fontSize:"0.9375rem",fontWeight:"600",loadingSpinner:true},
  reassuranceBadge:{border:"1px solid #0E7C3A",background:"#F2F6FA",borderRadius:"10px",paddingY:"10px",paddingX:"16px",iconColor:"#0E7C3A",textColor:"#0E7C3A",fontSize:"0.875rem",gap:"8px",exampleCopy:"Get your offers in 2 minutes or less."},
  secureFormBadge:{border:"1px solid #D2D9E5",background:"#F2F6FA",borderRadius:"10px",paddingY:"8px",paddingX:"12px",iconColor:"#1B3A5C",textColor:"#4A5568",fontSize:"0.8125rem",gap:"8px",exampleCopy:"Your information is secure"},
  successState:{border:"1px solid #0E7C3A",background:"#F2F6FA",borderRadius:"14px",padding:"24px 20px",iconColor:"#0E7C3A",iconSize:"32px",headingFontFamily:"'Literata',serif",headingFontSize:"1.375rem",headingColor:"#1A1F36",messageColor:"#4A5568",messageFontSize:"0.875rem"},
  trustBar:{gap:"1rem",itemGap:"8px",iconColor:"#0E7C3A",textColor:"#4A5568",fontSize:"0.8125rem",marginY:"1rem"},
  logoStrip:{gap:"1.5rem",logoMaxHeight:"32px",logoOpacity:"0.85",marginY:"1rem"},
  stepIndicator:{dotSize:"10px",gap:"8px",dotColor:"#E8EEF4",activeColor:"#1B3A5C",marginBottom:"1.5rem"},
  iconCardGrid:{columnsDesktop:3,columnsTablet:2,columnsMobile:1,gap:"0.5rem",marginBottom:"1.5rem"},
  // P1a answer-group layout system (register PC-1): the choice-family answer
  // grid (`.lg-answer-group` — ButtonAnswerGroup + TwoButtonYesNo) is a real
  // CSS grid, NOT the pre-P1a flow-packed chips (which measured 0-gap, unequal,
  // left-stuck). `columns` = the default track count (2 = the reference's
  // 2-col answer layout; authorable 1..4 per node). `gap` = 24px (== spacing.lg
  // /1.5rem, reused not invented): the reference funnel shows ~28px gutters in
  // its ~470px card column; our card interior is 508px (tokens content 600 −
  // 2×46 card padding), so a fixed 24px gutter — the low end of the reference's
  // ~24-28px band — leaves two equal cells of (508−24)/2 = 242px, matching the
  // reference's ~220-240px cell width. gapMobile narrows the gutter for the
  // sub-480 card interior (minmax(0,1fr) tracks guarantee no overflow).
  answerGrid:{columns:2,gap:"24px",gapMobile:"12px"},
  // P1a card cell geometry (register PC-11): minHeight 96→140 so an icon card
  // reads as a SQUARE-LEANING tile (the reference's ~150-190px square-ish icon
  // cards), not the pre-P1a 163×96 landscape cell. 140px comfortably seats the
  // 48px icon (P1b leadgenIconSvg glyph,48) + title (+ optional desc) stacked
  // and centered; at 3 cols in the 508px card interior each cell is ~164px wide
  // × ≥140 tall = square-leaning. Image cards share this cell but keep their
  // own aspect behavior (.lg-card-img object-fit:contain, max-height unchanged).
  iconCard:{border:"2px solid #D2D9E5",borderRadius:"10px",background:"#FFFFFF",minHeight:"140px",padding:"1rem",titleFontSize:"1rem",titleFontWeight:"700",titleColor:"#1A1F36",iconSize:"32px",iconColor:"#1B3A5C",hoverBorderColor:"#1B3A5C",hoverBackground:"#F2F6FA",selectedBorderColor:"#1B3A5C",selectedBackground:"#E8EEF4",focusRing:"outline 2px solid #1B3A5C; outline-offset 2px",disabledOpacity:"0.5",errorBorderColor:"#D32F2F"},
  // R7 U12: field box side padding 18px + radius 12px per golden :884
  // (fieldBoxStyle "padding:16px 18px;border-radius:12px"). padding 1rem(=16px
  // all sides)→"16px 18px" (16 vertical / 18 horizontal); borderRadius 10→12.
  input:{padding:"16px 18px",border:"2px solid #D2D9E5",borderRadius:"12px",fontSize:"1rem",focusBorderColor:"#1B3A5C",errorBorderColor:"#D32F2F",placeholderColor:"#718096"},
  dropdown:{inherits:"input",chevronSvgFill:"#5A6178"},
  validation:{errorTextColor:"#D32F2F",errorFontSize:"0.875rem",successColor:"#0E7C3A",helperColor:"#718096"},
  transitions:{stepFadeInMs:"300",cardHoverMs:"150",btnHoverMs:"200",btnEasing:"cubic-bezier(.34,1.56,.64,1)",progressFillMs:"400"},
  breakpoints:{mobileMax:"480px",smallMax:"400px",tinyMax:"375px",desktopMin:"640px",wideMin:"1024px"},
  banner:{cardBorder:"2px solid #D2D9E5",cardRadius:"20px",cardPadding:"1.5rem",recommendedBorder:"2px solid #E85D26",recommendedBg:"#FFFAF7",recommendedGlow:"0 4px 20px rgba(232,93,38,.12)",logoWidth:"140px",logoHeight:"60px",nameFontSize:"1.125rem",nameFontWeight:"700",ctaBackground:"#1B3A5C",ctaColor:"#FFFFFF",ctaRadius:"10px",ctaTextTransform:"uppercase",recommendedCtaBackground:"#E85D26",recommendedBadgeBg:"#1B3A5C",recommendedBadgeColor:"#FFFFFF"},
  // §8.5 layout containers (fix-contract v2.4 08, E4) — flat CSS-value records.
  // Every value REUSES the measured palette above (spacing scale, radius scale,
  // shadow scale, card/wash/ghost colours, navy/orange) — no new values invented.
  stack:{gapXs:"0.25rem",gapS:"0.5rem",gapM:"1rem",gapL:"1.5rem",gapXl:"2rem"},
  gridContainer:{gapXs:"0.25rem",gapS:"0.5rem",gapM:"1rem",gapL:"1.5rem",gapXl:"2rem",marginBottom:"1.5rem"},
  columns:{gap:"1rem",marginBottom:"1rem"},
  cardPanel:{widthS:"320px",widthM:"420px",widthL:"500px",widthFull:"100%",backgroundCard:"#FFFFFF",backgroundWash:"#E8EEF4",backgroundGhost:"#F2F6FA",backgroundTransparent:"transparent",shadowNone:"none",shadowSm:"0 1px 3px rgba(27,58,92,.06)",shadowMd:"0 4px 8px rgba(27,58,92,.06)",shadowLg:"0 8px 24px rgba(27,58,92,.08)",shadowXl:"0 16px 48px rgba(27,58,92,.10)",radiusSm:"6px",radiusMd:"10px",radiusLg:"14px",radiusXl:"20px",paddingS:"16px 12px",paddingM:"24px 20px",paddingL:"32px 28px",border:"1px solid #E8ECF2"},
  backgroundPanel:{backgroundCard:"#FFFFFF",backgroundWash:"#E8EEF4",backgroundGhost:"#F2F6FA",backgroundPage:"#F5F7FA",backgroundPrimary:"#1B3A5C",gradientPrimary:"linear-gradient(135deg,#1B3A5C,#2A5080)",gradientAccent:"linear-gradient(135deg,#E85D26,#D14E1C)",gradientWash:"linear-gradient(180deg,#F2F6FA,#E8EEF4)",padding:"2rem 1.5rem",radius:"14px"},
  spacer:{sizeXs:"0.25rem",sizeS:"0.5rem",sizeM:"1rem",sizeL:"1.5rem",sizeXl:"2rem"},
  headerBar:{background:"#FFFFFF",paddingY:"1rem",paddingX:"1.5rem",boxShadow:"0 1px 3px rgba(27,58,92,.06)",contentMaxWidth:"600px",gap:"1rem",logoMaxHeight:"32px",secureColor:"#4A5568",secureIconColor:"#1B3A5C",secureFontSize:"0.8125rem",ctaBackground:"#1B3A5C",ctaColor:"#FFFFFF",ctaRadius:"10px",ctaFontSize:"0.875rem",ctaPadding:"10px 16px",exampleSecureCopy:"Your information is secure"},
  footerBar:{background:"#F2F6FA",borderTop:"1px solid #E8ECF2",padding:"1.5rem",gap:"0.5rem",marginTop:"2rem",textColor:"#718096",fontSize:"0.75rem",linkColor:"#1B3A5C",trustColor:"#4A5568",trustFontSize:"0.8125rem"},
} as const;
export type DefaultFunnelDesign = typeof defaultFunnelDesign;

// v2.5 08 §8.4 — the TWO NEW iconCard slot groups (`iconCard.subtitle*` +
// `iconCard.badge*`) for per-choice depth (title/subtitle/badge). SIBLING
// export rather than keys on defaultFunnelDesign.iconCard: the design object
// serializes VERBATIM into the public config (`design_tokens`, config-dto.ts
// buildPublicConfig) and the A0 legacy byte-identity pin freezes those bytes
// — depth slots are render-side token inputs only, so they ride NEXT TO the
// design (same token file, same measured vocabulary) and presets.ts resolves
// them by design id (unknown id → default, the getFunnelDesign rule). Every
// value reuses the measured palette 1:1 — no new values invented:
//   subtitle* = the .lg-card-desc pair (subheadline.fontSize 0.825rem +
//               page.textSecondaryColor #4A5568);
//   badge*    = the recommended-badge navy/white pill (banner
//               .recommendedBadgeBg #1B3A5C / .recommendedBadgeColor #FFFFFF,
//               categoryLabel fontWeight 700, footerBar.fontSize 0.75rem,
//               radius.full 9999px, compact pill padding).
export const defaultFunnelIconCardDepthSlots = {
  subtitleFontSize: "0.825rem",
  subtitleColor: "#4A5568",
  badgeBackground: "#1B3A5C",
  badgeColor: "#FFFFFF",
  badgeFontSize: "0.75rem",
  badgeFontWeight: "700",
  badgeRadius: "9999px",
  badgePadding: "2px 8px",
} as const;

// The slot-group shape every design's token file provides (widened to string
// so additional designs supply their own measured values).
export type LeadgenIconCardDepthSlots = {
  readonly [K in keyof typeof defaultFunnelIconCardDepthSlots]: string;
};
