// LeadGen VISUAL DESIGN — "default-funnel" (default funnel visual design).
// Target: api/src/public/leadgen/designs/default-funnel/tokens.ts
// Measured 1:1 from the reference funnel stylesheet. Visual design only; SEPARATE
// from the component capability registry. No banned product name in source.
export const defaultFunnelDesign = {
  id: "default-funnel", source: "reference funnel stylesheet (measured)",
  page:{backgroundColor:"#F5F7FA",textColor:"#1A1F36",textSecondaryColor:"#4A5568",textLightColor:"#718096",fontFamily:"'Sora',system-ui,Arial,sans-serif",fontDisplay:"'Literata',Georgia,serif",minHeight:"100vh"},
  color:{primary:"#1B3A5C",primaryDark:"#0F2440",primaryLight:"#2A5080",accent:"#E85D26",accentHover:"#D14E1C",card:"#FFFFFF",border:"#D2D9E5",borderLight:"#E8ECF2",success:"#0E7C3A",error:"#D32F2F",primaryWash:"#E8EEF4",primaryGhost:"#F2F6FA",accentLight:"#FEF0EB",recommendedBg:"#FFFAF7",recommendedBorder:"#E85D26",recommendedGlow:"rgba(232,93,38,0.12)"},
  spacing:{xs:"0.25rem",sm:"0.5rem",md:"1rem",lg:"1.5rem",xl:"2rem",xxl:"3rem"},
  radius:{sm:"6px",md:"10px",lg:"14px",xl:"20px",full:"9999px"},
  shadow:{sm:"0 1px 3px rgba(27,58,92,.06)",md:"0 4px 8px rgba(27,58,92,.06)",lg:"0 8px 24px rgba(27,58,92,.08)",xl:"0 16px 48px rgba(27,58,92,.10)",glow:"0 8px 32px rgba(232,93,38,.12)"},
  header:{backgroundColor:"#FFFFFF",paddingY:"1rem",paddingX:"1.5rem",contentMaxWidth:"600px",align:"center",boxShadow:"0 1px 3px rgba(27,58,92,.06)",position:"sticky",logoFontFamily:"'Literata',serif",logoFontSize:"1.1rem",logoFontWeight:"700",logoColor:"#1B3A5C",logoAccentColor:"#E85D26"},
  backButton:{kind:"text",color:"#718096",fontSize:"0.875rem",hoverColor:"#1B3A5C"},
  disclosure:{color:"#718096",fontSize:"0.8rem",hoverColor:"#1B3A5C"},
  content:{maxWidth:"500px",offersMaxWidth:"420px",paddingDesktop:"1.5rem",paddingMobile:"1rem",cardPadding:"24px 20px",cardRadius:"14px"},
  progress:{height:"8px",trackColor:"#E8EEF4",fillColor:"linear-gradient(90deg,#1B3A5C,#2A5080)",borderRadius:"9999px",textColor:"#1B3A5C",marginBottom:"2rem"},
  headline:{fontFamily:"'Literata',serif",fontSizeDesktop:"1.75rem",fontSizeMobile:"1.375rem",fontWeight:"700",lineHeight:"1.25",color:"#1A1F36",textAlign:"center",marginBottom:"6px"},
  subheadline:{fontSize:"0.825rem",color:"#4A5568",textAlign:"center",marginBottom:"20px"},
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
  iconCard:{border:"2px solid #D2D9E5",borderRadius:"10px",background:"#FFFFFF",minHeight:"96px",padding:"1rem",titleFontSize:"1rem",titleFontWeight:"700",titleColor:"#1A1F36",iconSize:"32px",iconColor:"#1B3A5C",hoverBorderColor:"#1B3A5C",hoverBackground:"#F2F6FA",selectedBorderColor:"#1B3A5C",selectedBackground:"#E8EEF4",focusRing:"outline 2px solid #1B3A5C; outline-offset 2px",disabledOpacity:"0.5",errorBorderColor:"#D32F2F"},
  input:{padding:"1rem",border:"2px solid #D2D9E5",borderRadius:"10px",fontSize:"1rem",focusBorderColor:"#1B3A5C",errorBorderColor:"#D32F2F",placeholderColor:"#718096"},
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
