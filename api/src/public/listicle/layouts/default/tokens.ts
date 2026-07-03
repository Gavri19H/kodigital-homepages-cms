// Default Listicle layout — MEASURED Senior-Saving reference baseline (v1.2).
// Authoritative token contract. Do NOT replace with abstract theme language.
//
// §31.0 REQUIRED CAPTURE completed 2026-07-03 (mobile 390x844 + Disclosure
// interaction + lower-page groups; live computed CSS + bounding boxes via
// Playwright). Metadata convention (consumed by tokens-to-css.ts): `status`
// and every `measured*` field (strings AND nested objects) are metadata —
// skipped by the CSS mapper. Direct fields hold CSS-clean measured values ONLY.
// Capture dates therefore live in `measuredAt` / `measuredMobileAt` fields.
//
// HONESTY NOTE: the 2026-07-03 verification pass found the LIVE page has
// DRIFTED from the §30.1 top-page baseline (font Inter not Arial, header
// #e0072b not #ce2e35, headline two h2 36px/40px not one h1 38px/48px, hero
// radius 8px not 5px, body 18px not 20px). Baseline "measured" top-page values
// were NOT overwritten — see `measuredDriftRegister2026_07_03` below and
// docs/listicles/reference-layout-audit.md. Groups stamped measuredAt
// 2026-07-03 are coherent with the live page state of that date.
// The ONLY per-host brand swap is the logo.

export const defaultListicleLayoutTokens = {
  id: "default",
  source: "senior-saving-reference",
  status:
    "measured — §31.0 blockers resolved 2026-07-03; top-page baseline drift detected (see measuredDriftRegister2026_07_03)",
  viewports: {
    capturedDesktop: {
      viewportWidth: "1014px",
      viewportHeight: "857px",
      renderedPageWidth: "1000px",
      scrollbarWidth: "14px",
      measuredNote2026_07_03:
        "re-verified at 1014x857 with an overlay scrollbar (0px) → content width 982px vs baseline 967px; environment difference, not page drift",
    },
    mobile: {
      width: "390px",
      height: "844px",
      status: "measured",
      measuredAt: "2026-07-03",
      measuredFullPageHeight: "12621px",
      measuredContentWidth: "358px",
    },
  },

  // Live-page drift found by the 2026-07-03 §31.0 verification pass. Baseline
  // §30.1 values kept as-is; both values recorded here (never silently
  // overwritten). Full table: docs/listicles/reference-layout-audit.md.
  measuredDriftRegister2026_07_03: {
    pageFontFamily:
      "baseline Arial/Helvetica → live Inter via next/font (its fallback is Arial-metric-adjusted)",
    headerBackground: "baseline #ce2e35 → live #e0072b (inline style on <header>)",
    headerBorderBottom: "baseline 1px #f4d1d3 → live none",
    headerPaddingX: "baseline 20px → live 16px",
    logoSlot: "baseline 226x36@(20,15) → live 232.7x40@(16,12) (h-10 w-auto)",
    disclosureTriggerFontSize: "baseline 13px → live 12px (<1024px), 14px (>=1024px)",
    headline:
      "baseline one h1 38px/48px w700 ls-0.4 max-w820 mb19 → live two h2 36px/40px (+4px py = 48px line pitch) w700-via-strong ls-normal max-w-none m0; glyph top y=86 vs baseline 94",
    byline:
      "baseline avatar 31px, text 12px/15px w700 #4b5360 → live avatar 30px, h5 12px/18px w600 #4b5563 (16px gap + centered row confirmed)",
    hero: "baseline radius 5px mb22 → live radius 8px, margins 0 with 16px visual gaps (2:1 aspect + y=242 CONFIRMED)",
    bodyParagraph:
      "baseline 20px/30px #2a2a2a mb15 gap14-16 → live 18px/30px, intro #333333 / in-section #2c2c2c, margins 0 + 6px paddings = 12px gap",
  },

  page: {
    backgroundColor: "#ffffff",
    textColor: "#2a2a2a",
    fontFamily: "Arial, Helvetica, sans-serif",
    shellWidth: "100%",
    shellMinHeight: "100vh",
  },

  articleContainer: {
    maxWidth: "968px",
    paddingXDesktop: "16px",
    paddingXMobile: "16px",
    marginLeft: "auto",
    marginRight: "auto",
  },

  header: {
    height: "64px",
    backgroundColor: "#ce2e35",
    borderBottomColor: "#f4d1d3",
    borderBottomWidth: "1px",
    paddingX: "20px",
    paddingY: "0px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    boxSizing: "border-box",
  },

  logoSlot: {
    widthDesktop: "226px",
    heightDesktop: "36px",
    objectFit: "contain",
    objectPosition: "left center",
    display: "block",
    measuredLeft: "20px",
    measuredTop: "15px",
    measuredVisualHeight: "35px",
    measuredVisualWidth: "226px",
    measuredMobile2026_07_03:
      "at 390px the live logo does NOT downscale: 232.7x40 at (16,12), h-10 w-auto",
  },

  disclosureTrigger: {
    position: "top-right-header",
    color: "#ffffff",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "13px",
    fontWeight: "400",
    lineHeight: "16px",
    textDecoration: "none",
    cursor: "pointer",
    rightOffset: "20px",
    measuredRightEdge: "~981px",
    measuredLeftEdge: "~924px",
    measuredTop: "~27px",
    measuredHeight: "~13px",
    measuredMobile2026_07_03:
      "at 390px: 12px/16px #fff, right offset 16px, top y=24 (live trigger is 12px below 1024px / 14px above — baseline 13px matches neither; see drift register)",
  },

  disclosureInteraction: {
    // MEASURED 2026-07-03 by clicking the live trigger (desktop 1014x857).
    // This group is behavioral (never emitted as CSS).
    type: "dropdown-panel",
    status: "measured",
    measuredAt: "2026-07-03",
    measured: {
      trigger:
        "click on the header top-right 'Disclosure' <p> (12px/16px #fff, cursor pointer) inside a relative z-10 wrapper",
      panelPosition:
        "absolute, below the trigger (top-full + 8px offset), right-aligned to the trigger's right edge",
      panelWidth: "288px",
      panelBackgroundColor: "#ffffff",
      panelTextColor: "#000000",
      panelFontSize: "16px",
      panelLineHeight: "24px",
      panelPadding: "16px",
      panelBorderRadius: "4px",
      panelBoxShadow:
        "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1) (shadow-lg)",
      animation: "none (appears/disappears instantly; no transition/keyframes)",
      focusTrap: "none (focus stays on body)",
      backdrop: "none",
      scrollLock: "none (page keeps scrolling)",
      dismiss:
        "outside click ONLY; Escape does NOT close; re-clicking the trigger keeps it open (no toggle-close)",
      mobileBehavior: "same pattern at 390px; trigger right offset 16px",
      contentStart:
        "This site is a free resource offering valuable content and comparison tools…",
      evidence: "docs/listicles/reference-desktop-disclosure-open.png",
    },
  },

  articleTopSpacing: {
    headerBottomY: "64px",
    h1FirstGlyphTopY: "94px",
    visualGap: "30px",
    paddingTopDesktop: "23px",
    paddingTopMobile: "20px",
    measuredMobileAt: "2026-07-03",
    measuredMobileNote:
      "at 390px: headline BOX top y=84 (16px band below header + 4px headline padding), first glyph y≈89 → 25px visual glyph gap. Live desktop: box y=84, glyph y≈86 (baseline said 94/30px — top-page drift).",
  },

  articleHeadline: {
    fontFamily: "Arial, Helvetica, sans-serif",
    color: "#2c2c2c",
    fontSizeDesktop: "38px",
    fontSizeMobile: "24px",
    fontWeight: "700",
    lineHeightDesktop: "48px",
    lineHeightMobile: "32px",
    letterSpacing: "-0.4px",
    textAlign: "center",
    maxWidth: "820px",
    marginTop: "0px",
    marginBottom: "19px",
    measuredLine1GlyphBox: "y=94-128",
    measuredLine2GlyphBox: "y=142-168",
    measuredLineTopToTop: "48px",
    measuredMobileAt: "2026-07-03",
    measuredMobileNote:
      "MEASURED at 390px: the mobile headline is a separate <div class='text-2xl py-1'><strong> variant (the desktop h2 pair is hidden below 640px): 24px/32px + 4px padding-y, centered, #2c2c2c, weight 700 via <strong>; each of the 2 authored lines wraps to 2 rendered lines (4 text lines total; glyph rows y=89/121/161/193). Provisional 32px/39px corrected. DESKTOP DRIFT: live desktop is two h2 36px/40px, not one h1 38px/48px (see drift register).",
  },

  byline: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "16px",
    marginBottom: "16px",
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "12px",
    lineHeight: "15px",
    fontWeight: "700",
    color: "#4b5360",
    avatarSize: "31px",
    avatarRadius: "999px",
    measuredAvatarX: "327-357px",
    measuredAvatarY: "196-226px",
    measuredTextX: "374-670px",
    measuredTextY: "203-217px",
    measuredMobile2026_07_03:
      "at 390px: identical pattern — avatar 30px, gap 16px, h5 12px/18px w600 #4b5563, centered; the 'Updated:' date is DYNAMIC (renders the current date — mask in visual regression)",
  },

  heroImage: {
    width: "100%",
    measuredWidth: "967px",
    measuredHeight: "484px",
    measuredX: "16px",
    measuredY: "242px",
    aspectRatio: "2 / 1",
    objectFit: "cover",
    objectPosition: "center center",
    borderRadius: "5px",
    marginTop: "0px",
    marginBottom: "22px",
    display: "block",
    measuredMobile2026_07_03:
      "at 390px: 358x179 (exact 2:1) at y=290, radius 8px (rounded-lg on the img), 16px visual gap to byline above and first paragraph below. DESKTOP DRIFT: live radius is 8px not 5px (see drift register).",
  },

  bodyParagraph: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSizeDesktop: "20px",
    fontSizeMobile: "18px",
    lineHeightDesktop: "30px",
    lineHeightMobile: "30px",
    fontWeight: "400",
    color: "#2a2a2a",
    letterSpacing: "0px",
    marginTop: "0px",
    marginBottom: "15px",
    measuredX: "16px",
    measuredParagraphGap: "14-16px",
    measuredMobileAt: "2026-07-03",
    measuredMobileNote:
      "MEASURED at 390px: 18px/30px, 6px padding-y (12px visual paragraph gap) — identical to live desktop; provisional mobile line-height 27px corrected to 30px. DESKTOP DRIFT: live desktop body is 18px/30px too (not 20px/30px); intro paragraphs #333333, in-section paragraphs #2c2c2c (see drift register).",
  },

  strongText: { fontWeight: "700", color: "#2a2a2a" },

  sectionWrapper: {
    // MEASURED: section containers carry NO margins of their own; sections are
    // separated by an <hr> divider (details in `measured`). Implementation
    // note: `.lst-spacer` currently consumes marginTop — with the measured 0px
    // the divider rhythm must come from a real divider element (see audit).
    marginTop: "0px",
    marginBottom: "0px",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844 (identical divider values at both)",
    measured: {
      separator: "hr between sections — classes 'h-px mt-8 mb-5 bg-gray-200 border-[1.8px]'",
      separatorMarginTop: "32px",
      separatorMarginBottom: "20px",
      separatorHeight: "3px (1.5px top + 1.5px bottom border)",
      separatorColor: "#e5e7eb",
      headingWrapperPaddingTop: "4px",
      headingWrapperMarginBottom: "8px",
      visualGapLastCtaToDivider: "32px",
      visualGapDividerToNextHeadingBox: "24px (20px hr margin + 4px heading-wrapper padding)",
      sectionCount: "6 sections on the reference page",
    },
  },

  sectionHeading: {
    // MEASURED from Section 1 (pattern uniform across sections 1-5; the h3
    // carries no font-family of its own — it inherits the page font).
    fontSizeDesktop: "22.4px",
    fontSizeMobile: "22.4px",
    lineHeightDesktop: "29.6px",
    lineHeightMobile: "29.6px",
    fontWeight: "700",
    color: "#2c2c2c",
    paddingY: "4px",
    marginTop: "0px",
    marginBottom: "0px",
    textDecoration: "none",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      element: "h3 wrapped in <a> linking to the section's offer URL (LINKED heading)",
      classes:
        "text-3xl py-1 !leading-[29.6px] lg:!leading-[40.8px] !font-bold !text-[22.4px] lg:!text-[27.2px]",
      lgVariant:
        "27.2px/40.8px at >=1024px (stylesheet lg: variant; both capture viewports are below 1024px)",
      wrapper:
        "div 'pt-1 mb-2 hover:underline hover:text-gray-700' → 4px above / 8px below the heading; hover: underline + #374151",
      numberBadge:
        "ALL 6 headings start with a numbered badge span ('1.'…'6.'): bg #d1d5db (bg-gray-300), 6px padding-x, border-radius 8px, inline-flex, 6px margin-right, own line-height 24.6px (<1024px) / 35.8px (>=1024px)",
      section6Anomaly:
        "section 6's heading alone sits inside 'hidden sm:block' with NO mobile counterpart — section 6 renders no heading at 390px; sections 1-5 render at both viewports",
    },
  },

  sectionImage: {
    // MEASURED: 982x552.4 desktop / 358x201.4 mobile — 16:9, NOT the hero's
    // 2:1. Radius lives on the wrapper (rounded-sm overflow-hidden), 2px.
    width: "100%",
    aspectRatio: "16 / 9",
    objectFit: "cover",
    objectPosition: "center center",
    borderRadius: "2px",
    marginTop: "0px",
    marginBottom: "0px",
    display: "block",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      wrapper: "div 'w-full aspect-[16/9] relative rounded-sm overflow-hidden' (img itself radius 0)",
      visualGapHeadingToImage: "8px",
      visualGapImageToParagraph: "16px",
      heroParity:
        "does NOT match the hero: hero img is 2:1 with 8px radius on the img; section images are 16:9 with 2px radius on a wrapper — provisional '2:1 radius 5px mt12 mb20' corrected",
    },
  },

  inlineLink: {
    // MEASURED from live provider links ('Choice Home Warranty', 'this tool',…):
    // classes 'text-blue-500 underline hover:text-blue-700'. Provisional
    // (#ce2e35 bold no-underline, hover #b9272e) fully corrected.
    color: "#3b82f6",
    fontWeight: "400",
    fontSize: "18px",
    lineHeight: "30px",
    textDecoration: "underline",
    hoverColor: "#1d4ed8",
    hoverTextDecoration: "underline",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      inheritance: "font-size/line-height inherit the 18px/30px body paragraph",
      hoverSource: "CSSOM rule .hover\\:text-blue-700:hover → rgb(29 78 216) = #1d4ed8",
    },
  },

  choiceButton: {
    // MEASURED: <button style="background: var(--listicle-cta-secondary-color)">
    // with :root { --listicle-cta-secondary-color: #f8020e }. Hover is a
    // transform (scale 1.05) — background does NOT change; no active rule
    // exists, so hover/active tokens hold the measured unchanged color.
    backgroundColor: "#f8020e",
    color: "#ffffff",
    borderColor: "#b9c6ce",
    hoverBackgroundColor: "#f8020e",
    activeBackgroundColor: "#f8020e",
    fontSize: "18px",
    fontWeight: "700",
    lineHeight: "28px",
    borderWidth: "1px",
    borderRadius: "8px",
    paddingY: "10px",
    paddingX: "20px",
    width: "100%",
    maxWidth: "none",
    minHeight: "62px",
    marginTop: "4px",
    marginBottom: "0px",
    cursor: "pointer",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      backgroundSource:
        ":root { --listicle-cta-secondary-color: #f8020e } (CMS-injected; --listicle-cta-main-color is also #f8020e)",
      hover: "transform scale(1.05) via .hover\\:scale-105:hover; transition all 200ms; background/color unchanged",
      active: "no active-state rule present on the reference",
      labelStructure:
        "label rendered by inner <p class='text-base text-lg py-1.5'> → 18px/28px + 6px padding-y; the button element itself computes 16px/24px and has no min-height — rendered height 62px = 10px pad + 1px border + (28px line + 12px label pad) + 1px + 10px; minHeight 62px is the single-element equivalent",
      fontFamilyNote: "no own font-family — inherits the page font",
      widths: "982px (1-col groups) / 487px (2-col groups) at 1014px; 358px / 175px at 390px",
      buttonWrapper: "each <button> is wrapped in a block <a> to the offer URL; mt-1 4px sits on the button inside the <a>",
      provisionalCorrected:
        "bg #ce2e35→#f8020e; radius 6px→8px; padding 14/18→10/20; min-h 52→62; max-w 720px→none; hover color-change→scale transform",
    },
  },

  choiceButtonGroup: {
    // MEASURED (previously carried unverified flex-column defaults, no status):
    // the group is a CSS GRID, not a flex column.
    display: "grid",
    gap: "8px",
    marginTop: "8px",
    marginBottom: "0px",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      columns6and3Buttons:
        "grid-cols-1 lg:grid-cols-3 → 1 column at 1014px capture and at 390px; 3 columns at >=1024px",
      columns2and4Buttons: "grid-cols-2 lg:grid-cols-2 → 2 columns at every measured viewport",
      buttonsPerGroupBySection:
        "S1=6, S2=2, S3=4, S4=4, S5=none, S6=3 — contract counts 6/2/4/4/3 confirmed for the 5 groups; the page has SIX sections (section 5 has no choice group)",
      followUpCta:
        "each group is followed by a full-width button-styled <a> ('flex justify-center items-center gap-2 my-2 text-center' + the same button classes) — same #f8020e/62px look, 8px above/below",
      provisionalCorrected: "flex column gap8 mt16 mb20 → grid gap8 mt8 mb0 (columns vary by count/viewport)",
    },
  },

  textCta: {
    // MEASURED: the reference's final text CTA ('… ➝ Check Eligibility Here')
    // is an INLINE link inside the closing paragraph, styled identically to
    // inlineLink. Provisional (#ce2e35 20px bold block no-underline) corrected.
    display: "inline",
    color: "#3b82f6",
    fontSize: "18px",
    fontWeight: "400",
    lineHeight: "30px",
    textAlign: "left",
    textDecoration: "underline",
    hoverColor: "#1d4ed8",
    hoverTextDecoration: "underline",
    marginTop: "0px",
    marginBottom: "0px",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      context: "sits inside the closing paragraph (18px/30px, 6px padding-y)",
      identicalTo: "inlineLink — the reference has no distinct final-text-CTA style",
    },
  },

  listBlock: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: "20px",
    lineHeight: "30px",
    color: "#2a2a2a",
    marginTop: "10px",
    marginBottom: "16px",
    itemMarginBottom: "8px",
    paddingLeft: "0px",
    listStyle: "none",
    checkmarkMarker: "✔️ ",
    checkmarkMarkerSize: "20px",
    bulletMarker: "• ",
    bulletMarkerColor: "#2a2a2a",
  },

  legalDisclosureBlock: {
    // MEASURED: full-width white band 'pt-4 pb-4 flex justify-center' between
    // the last section divider and the footer; paragraph 'py-1.5 text-base'.
    // Provisional (14px/21px #4b4b4b mt32 mb24) corrected.
    fontSize: "16px",
    lineHeight: "24px",
    color: "#000000",
    fontWeight: "400",
    marginTop: "0px",
    marginBottom: "0px",
    paddingY: "6px",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      band: "full-width div 'pt-4 pb-4 flex justify-center' on white (16px padding-y); a second identical band with an empty paragraph follows before the footer",
      textStart: "Disclosure: This website is privately owned and operated…",
    },
  },

  footer: {
    // MEASURED: <footer class='shadow' style='background-color:#000002'> —
    // near-black band with white text; inner 'w-full max-w-screen-xl mx-auto
    // p-4 md:py-8'. Provisional (white bg, #2a2a2a links, 12px legal) corrected.
    // Direct values are the capture-viewport (1014px) values; responsive
    // variants in `measured`.
    backgroundColor: "#000002",
    borderTopColor: "transparent",
    borderTopWidth: "0px",
    paddingTop: "32px",
    paddingBottom: "32px",
    paddingX: "16px",
    footerLogoWidth: "232.7px",
    footerLogoHeight: "40px",
    footerLogoMarginBottom: "16px",
    linkColor: "#ffffff",
    linkFontSize: "14px",
    linkLineHeight: "20px",
    linkFontWeight: "500",
    linkTextDecoration: "none",
    linkHoverTextDecoration: "underline",
    legalFontSize: "14px",
    legalLineHeight: "20px",
    legalColor: "#ffffff",
    legalMarginTop: "0px",
    copyrightFontSize: "14px",
    copyrightLineHeight: "20px",
    copyrightColor: "#ffffff",
    copyrightMarginTop: "0px",
    status: "measured",
    measuredAt: "2026-07-03",
    measuredViewport: "1014x857 + 390x844",
    measured: {
      backgroundSource: "inline style on <footer> (CMS-injected)",
      innerContainer:
        "'w-full max-w-screen-xl mx-auto p-4 md:py-8' → padding-x 16px; padding-y 32px at >=768px, 16px below (16px at the 390px capture)",
      logo: "same white logo asset as the header, h-10 w-auto → 232.7x40 (intrinsic-ratio width; provisional 180px corrected); mb-4 16px below 640px, 0 in the >=640px row layout; links to /29-benefits",
      layout: "'sm:flex sm:items-center sm:justify-between' → logo left / nav links right at >=640px; fully stacked at 390px",
      navLinks:
        "Contact · Privacy policy · Terms of use — 14px/20px w500 #ffffff (inline style on the ul), margin-inline-end 24px at >=768px (me-6) / 16px below; ul mb-6 24px below 640px",
      dividerHr: "'my-6 border-gray-400 sm:mx-auto lg:my-8' → 24px margins (32px at >=1024px), border #9ca3af",
      legalText: "14px/20px #ffffff (inline style), text-align justify, margin-bottom 16px",
      copyright:
        "'© 2026 Copyright: senior-saving.com' — 14px/20px #ffffff; padding-bottom 69px below 1024px (pb-[69px]) / 40px at >=1024px (lg:pb-10); the 16px separation above it comes from the legal paragraph's margin-bottom",
    },
  },
} as const;

export type DefaultListicleLayoutTokens = typeof defaultListicleLayoutTokens;
