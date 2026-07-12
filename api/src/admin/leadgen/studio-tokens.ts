// LeadGen Section STUDIO — admin design tokens (contract v3.1 §3 + §3.1b +
// Appendix B). These are the ONLY values the admin Studio chrome may use; they
// are the literal constants of the committed golden master
// (docs/leadgen/redesign-contract-v3/golden/golden-master-source.dc.html).
//
// IMPORTANT — this is a CONSTANTS module, NOT a funnel theme. The data-driven
// funnel *Themes* of §10 (roles/typography/controls/spacing over the
// lg-funnel-themes KV) are a separate concept owned by Phase D. Nothing here
// is persisted or A/B-tested; these are the fixed pixels/hex/geometry of the
// authoring surface itself.
//
// USAGE CONTRACT (why the render code references these):
//  - The studio's server-rendered chrome interpolates these constants into its
//    inline-style strings so the emitted bytes stay identical to the golden
//    (e.g. `border-bottom:1px solid ${STUDIO_COLOR.lineStrip}` emits
//    `...#E7EBF1`, byte-for-byte with golden line 60) WHILE the value traces to
//    a single audited source — this is what lets the §13 Gate-1b token audit
//    assert "computed styles resolve only to §3 values, per the §3.1b
//    placement map".
//  - Where Appendix D marks an element "defer to source" (the 20 tile SVGs, the
//    selection handles), the verbatim golden string is copied literally; its
//    colors/px are §3 values by construction, so the audit still passes. The
//    ES5 island (which cannot import) keeps those copied literals inline.
//
// Every hex is byte-exact with the golden (note the lowercase `#16324f`).

// ---------------------------------------------------------------------------
// §3.1 Color — the semantic palette. Multi-shade tokens (§3.1b) are split into
// distinctly-named keys because each shade has an asserted placement.
// ---------------------------------------------------------------------------
export const STUDIO_COLOR = {
  // text
  ink: "#1A1F36", // primary text
  inkStrong: "#111726", // section name, screen titles
  text2: "#2A3346", // control labels, tile names
  text2Strong: "#41495B", // text-2 (darker) — labels/values
  muted: "#5A6470", // §3.1b chrome icon strokes · top-bar chip text · drawer inactive tabs
  mutedLabel: "#6B7486", // §3.1b form-control labels · unselected segmented text
  faint: "#8A93A3", // §3.1b group eyebrows · inactive scope pills · inactive inspector tabs · dropdown chevrons
  faintSub: "#98A1B0", // §3.1b sub-copy under controls · Advanced chip text
  faintEyebrow: "#9BA3B1", // §3.1b inspector section eyebrows only

  // lines / borders (§3.1b disambiguation)
  linePanel: "#E4E8EF", // panel borders · top-bar/toolbar/drawer dividers
  lineControl: "#E1E6EE", // input & dropdown control borders
  lineHairline: "#EEF1F6", // inspector hairlines · inherited-row borders
  lineStrip: "#E7EBF1", // question-strip bottom border · Maps job-row & Rules card borders

  // surfaces
  appBg: "#EDF0F4", // body gutter / canvas surface (§2.1)
  page: "#D9DEE6", // behind the app frame

  // brand navy
  navy: "#1B3A5C", // primary buttons · selection outline · active pill/tab text · handles
  navyHover: "#16324f", // primary hover (byte-exact lowercase)
  navyTint: "#EAF0F6", // selected/active tints · breadcrumb chip

  // accent (yellow discipline — star / active tab underline / affects-line star ONLY)
  accent: "#F5C518",

  // status
  success: "#0E7C3A",
  successTint: "#E4F2E9",
  successTintAlt: "#E9F4EE",
  infoBlue: "#2E6BB0",
  infoBlueTint: "#EAF1F8",
  warn: "#B8860B",
  warnStrong: "#8A6D00",
  warnTint: "#FDF4E3",
  danger: "#B23A2C",

  // structural surface literals cited by §2 / §3.3 / Appendix B (kept here so
  // the shell chrome single-sources them — each appears verbatim in the golden)
  stripBg: "#F7F9FB", // §2.1 question-strip background (golden :60)
  questionCardBorder: "#E9EDF3", // §2.2 question card border (golden :308)
  dotGrid: "#DCE1EA", // §2.2 canvas dot-grid dots (golden :295)
  segmentTrack: "#EDF0F5", // §3.3 segmented-control track
  toggleOff: "#CBD3DF", // Appendix B toggle off-state track
  checkboxOffBorder: "#C7CFDB", // Appendix B Maps-job checkbox off border
  white: "#FFFFFF",

  // additional literals used verbatim by specific Phase-B elements (golden
  // line refs in each comment) — found by an exhaustive hex sweep of the
  // owned regions (top bar 29-57, strip 59-97, library 102-258, canvas
  // 260-388, + the shared seg/segFull/vpSeg/tab/chev/cb/frameBtnStyle/
  // fieldBoxStyle/fieldWrapStyle helpers 741-767/803-935). Excludes hexes that
  // appear ONLY in Phase C (inspector 390-620) or Phase D (Themes 627-720 +
  // pal()/themeCard() 768-780) regions.
  sectionEyebrow: "#A2AAB8", // "SECTION"/"· optional" eyebrow text (golden :37, :89)
  questionEyebrow: "#9098A6", // "The question" strip eyebrow (golden :62)
  archiveText: "#8A5050", // Archive button default text (golden :55)
  archiveHoverBg: "#FBEEEC", // Archive button hover background (golden :55)
  issuesChipBg: "#F1F3F7", // "No issues" chip bg (golden :49); drawer inactive-tab hover bg (golden :376-377)
  mapsChipBg: "#EEF2F7", // strip "Google Maps: connected" chip bg (golden :77); drawer active chip bg (golden :372)
  mappingBadgeBg: "#DBEEE2", // bottom-drawer "2/2" count-pill bg (golden :374)
  stripInputBorder: "#DDE3EC", // headline/subheadline input borders (golden :86, :90)
  hintIconStroke: "#B4BCC9", // hint-icon stroke + group chevrons (golden :93, :116/:143/:202/:225)
  searchIconStroke: "#9AA3B2", // search-icon stroke (golden :107); frame-hint info icon (golden :540/:554 shared hex)
  tileHoverBg: "#F7F9FC", // library tile hover background (golden :122 etc.)
  searchInputBg: "#F8FAFC", // library search input background (golden :108)
  tileStrokeSecondary: "#9AA9BD", // tile SVG secondary stroke (contract §5.1)
  tileLineSecondary: "#C2CCDA", // tile SVG secondary line/text-stand-in stroke (contract §5.1)
  contentDashedBorder: "#D5DCE6", // library Content-group dashed border + callout copy box (golden :220)
  contentDashedText: "#78818F", // library Content-group dashed-callout copy text (golden :220)
  answerFieldsSubcopy: "#BAC2CF", // "how visitors answer" subcopy (golden :145)
  frameCalloutBorder: "#D4E2F0", // library Frame Callout border (golden :250)
  frameCalloutLinkUnderline: "#9DBCDD", // Frame Callout "Open →" underline (golden :253)
  frameCalloutText: "#33506F", // Frame Callout copy text + frame-hint logo text (golden :253, :302)
  breadcrumbChevron: "#C2CACF", // canvas-toolbar breadcrumb chevron (golden :268); frame-hint dot off-state (helper :845)
  frameHintTagBg: "#E5E9F0", // "Funnel frame" tag background (golden :301)
  frameHintTagText: "#7C889A", // "Funnel frame" tag text + footer disclosure text (golden :301, :363)
  frameHintProgressTrack: "#D3DBE6", // frame-hint progress bar track (golden :303)
  frameHintProgressFill: "#9DB0C6", // frame-hint progress bar fill (golden :303)
  frameHintDot: "#96A3B5", // "brand·logo" middle-dot color (golden :302)
  subheadlineText: "#63707F", // canvas question-unit subheadline text (golden :313)
  fieldIconStroke: "#8DA0B6", // ZIP field leading-icon (pin) stroke (golden :323)
  fieldPlaceholderText: "#9AA6B4", // "Enter your ZIP code" placeholder text (golden :324)
  fieldHelperText: "#96A0AF", // "We never share this" helper text below the field (golden :326)
  fieldBoxBorderInactive: "#D7DEE8", // unselected field box border (helper fieldBoxStyle inactive branch, golden :884)
} as const;

// §3.1b placement map (asserted): which shade goes where. Documented as data so
// a future token audit can enforce "this hex is only legal in these contexts".
export const STUDIO_COLOR_PLACEMENT: Readonly<Record<string, readonly string[]>> = {
  "#5A6470": ["chrome icon strokes", "top-bar chip text", "drawer inactive tabs"],
  "#6B7486": ["form-control labels", "unselected segmented text"],
  "#8A93A3": ["group eyebrows", "inactive scope pills", "inactive inspector tabs", "dropdown chevrons"],
  "#98A1B0": ["sub-copy under controls", "Advanced chip text"],
  "#9BA3B1": ["inspector section eyebrows only"],
  "#E4E8EF": ["panel borders", "top-bar/toolbar/drawer dividers"],
  "#E1E6EE": ["input & dropdown control borders"],
  "#EEF1F6": ["inspector hairlines", "inherited-row borders"],
  "#E7EBF1": ["question-strip bottom border", "Maps job-row & Rules card borders"],
} as const;

// ---------------------------------------------------------------------------
// §3.2 Type. Inter = all admin chrome; Newsreader = rendered funnel-preview
// headline + frame-hint logo + the "Aa" Text-tile glyph ONLY; Roboto Mono =
// Advanced ids/tokens only. OFL Google fonts — no substitution.
// ---------------------------------------------------------------------------
export const STUDIO_TYPE = {
  family: {
    inter: "Inter,system-ui,Arial,sans-serif",
    newsreader: "Newsreader,serif",
    robotoMono: "'Roboto Mono',monospace",
  },
  // Key sizes (px) from §3.2.
  size: {
    eyebrow: 11, // 10.5–11 / 800 / uppercase
    eyebrowSmall: 10.5,
    controlLabel: 12, // /600
    tileName: 12.5, // /600
    bodyMeta: 11.5, // 11.5–12
    inspectorTitle: 15.5, // /800
    canvasHeadline: 31, // Newsreader /600
    themesTitle: 21, // /800
  },
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
    heavy: 800,
  },
  // Section eyebrow letter-spacing range (§3.2): 1.1–1.4px.
  eyebrowLetterSpacing: { min: 1.1, max: 1.4 },
} as const;

// ---------------------------------------------------------------------------
// §3.3 Spacing & radius. 4px grid.
// ---------------------------------------------------------------------------
export const STUDIO_RADIUS = {
  control: 8, // controls / inputs
  tile: 9, // library tiles
  card: 10, // tiles/cards upper bound (9–10)
  questionCard: 16, // the question unit card
  continue: 11, // continue button
  pill: 20, // pills / chips
  swatch: 10, // theme swatches
  handle: 3, // resize handles
} as const;

export const STUDIO_SPACE = {
  grid: 4,
  // Segmented control (§3.3): track bg #EDF0F5, 2px pad, selected pill white +
  // shadow 0 1px 2px rgba(16,24,40,.1).
  segmented: {
    track: STUDIO_COLOR.segmentTrack,
    pad: 2,
    selectedBg: STUDIO_COLOR.white,
    selectedShadow: "0 1px 2px rgba(16,24,40,.1)",
  },
} as const;

// ---------------------------------------------------------------------------
// Appendix B — Geometry constants (the quick set; "everything else" defers to
// the golden verbatim style strings via Appendix D).
// ---------------------------------------------------------------------------
export const STUDIO_GEOMETRY = {
  appFrame: { width: 1440, height: 944 },

  // region heights / rail widths (§2.1)
  topBarHeight: 56,
  canvasToolbarHeight: 46,
  bottomDrawerHeight: 42,
  leftLibraryWidth: 292,
  rightInspectorWidth: 344,
  themesListWidth: 300, // §10 (Phase D)
  themesAbPanelWidth: 320, // §10 (Phase D)
  unitColumnWidth: 600, // §2.2 the question unit column

  // §2.2 question unit card
  questionCard: {
    radius: 16,
    padding: "44px 46px 40px",
    shadow: "0 8px 28px rgba(20,32,54,.10)",
    border: STUDIO_COLOR.questionCardBorder,
  },

  // §2.2 canvas dot grid
  dotGrid: { color: STUDIO_COLOR.dotGrid, dot: "1px", pitch: "22px" },

  // §6.2 selection chrome + 8 handles (exact offsets from golden :328–347)
  selection: {
    outlineWidth: 2,
    outlineColor: STUDIO_COLOR.navy,
    inset: -6, // outline inset (name-tag / badge anchor)
    outlineRadius: 12, // field selection outline radius
    handleSize: 11, // 11×11
    handleRadius: 3,
    handleSideOffset: -11, // left/right handles at −11px
    handleRows: { top: -11, mid: 19, bottom: 49 }, // three handle rows
    nameTag: { top: -30, left: -6, radius: "6px 6px 6px 0" },
    customBadge: { top: -30, right: -6, radius: "6px 6px 0 6px" },
  },

  // §5.1 tiles
  tile: { padding: "13px 8px 10px", cols: 2, gap: 8, border: STUDIO_COLOR.linePanel, radius: STUDIO_RADIUS.tile },

  // §5 group header padding (12 2 9; 16px top for subsequent groups)
  groupHeaderPadding: "12px 2px 9px",
  groupHeaderTopSubsequent: 16,

  // §4.2 question strip padding
  questionStripPadding: "14px 20px 16px",

  // input paddings (Appendix B)
  inputPadding: { strip: "10px 13px", inspector: "9px 11px", search: "9px 12px 9px 34px" },

  // toggles (Appendix B): 38×22 track · 18px knob · on navy / off #CBD3DF
  // (strip variant 34×19 / 15px knob)
  toggle: {
    trackWidth: 38,
    trackHeight: 22,
    knob: 18,
    on: STUDIO_COLOR.navy,
    off: STUDIO_COLOR.toggleOff,
    stripTrackWidth: 34,
    stripTrackHeight: 19,
    stripKnob: 15,
  },

  // Maps-job checkbox (Appendix B): 20×20 · radius 6 · on navy+white check /
  // off 1.6px #C7CFDB
  mapsCheckbox: { size: 20, radius: 6, on: STUDIO_COLOR.navy, offBorder: `1.6px ${STUDIO_COLOR.checkboxOffBorder}` },

  // active inspector-tab underline (§3.1 / Appendix B): 2px accent
  activeTabUnderline: `2px ${STUDIO_COLOR.accent}`,
} as const;

// Convenience aggregate — one import surface for the render code.
export const STUDIO_TOKENS = {
  color: STUDIO_COLOR,
  colorPlacement: STUDIO_COLOR_PLACEMENT,
  type: STUDIO_TYPE,
  radius: STUDIO_RADIUS,
  space: STUDIO_SPACE,
  geometry: STUDIO_GEOMETRY,
} as const;

export type StudioColorToken = keyof typeof STUDIO_COLOR;
