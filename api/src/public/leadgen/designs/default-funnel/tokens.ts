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
  iconCardGrid:{columnsDesktop:3,columnsTablet:2,columnsMobile:1,gap:"0.5rem",marginBottom:"1.5rem"},
  iconCard:{border:"2px solid #D2D9E5",borderRadius:"10px",background:"#FFFFFF",minHeight:"96px",padding:"1rem",titleFontSize:"1rem",titleFontWeight:"700",titleColor:"#1A1F36",iconSize:"32px",iconColor:"#1B3A5C",hoverBorderColor:"#1B3A5C",hoverBackground:"#F2F6FA",selectedBorderColor:"#1B3A5C",selectedBackground:"#E8EEF4",focusRing:"outline 2px solid #1B3A5C; outline-offset 2px",disabledOpacity:"0.5",errorBorderColor:"#D32F2F"},
  input:{padding:"1rem",border:"2px solid #D2D9E5",borderRadius:"10px",fontSize:"1rem",focusBorderColor:"#1B3A5C",errorBorderColor:"#D32F2F",placeholderColor:"#718096"},
  dropdown:{inherits:"input",chevronSvgFill:"#5A6178"},
  validation:{errorTextColor:"#D32F2F",errorFontSize:"0.875rem",successColor:"#0E7C3A",helperColor:"#718096"},
  transitions:{stepFadeInMs:"300",cardHoverMs:"150",btnHoverMs:"200",btnEasing:"cubic-bezier(.34,1.56,.64,1)",progressFillMs:"400"},
  breakpoints:{mobileMax:"480px",smallMax:"400px",tinyMax:"375px",desktopMin:"640px",wideMin:"1024px"},
  banner:{cardBorder:"2px solid #D2D9E5",cardRadius:"20px",cardPadding:"1.5rem",recommendedBorder:"2px solid #E85D26",recommendedBg:"#FFFAF7",recommendedGlow:"0 4px 20px rgba(232,93,38,.12)",logoWidth:"140px",logoHeight:"60px",nameFontSize:"1.125rem",nameFontWeight:"700",ctaBackground:"#1B3A5C",ctaColor:"#FFFFFF",ctaRadius:"10px",ctaTextTransform:"uppercase",recommendedCtaBackground:"#E85D26",recommendedBadgeBg:"#1B3A5C",recommendedBadgeColor:"#FFFFFF"},
} as const;
export type DefaultFunnelDesign = typeof defaultFunnelDesign;
