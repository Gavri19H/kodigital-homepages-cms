// LeadGen Section STUDIO — the fix-contract v2.4 08 editor layer (Phase 4
// Slice D1). Replaces ui-question-builder.ts as the EDITOR page's builder:
// §8.1 studio layout (top bar · library rail · canvas · inspector · bottom
// drawer), §8.3 component library (preset-rendered thumbnails, grouped by
// intent, searchable, drag + click-to-add), §8.4 canvas (REAL preset renderer
// output as a live DOM region + selection overlay, drag-drop with insertion
// indicators, container drops, depth-4 refusal, breadcrumb, reorder,
// duplicate/delete/add-before/add-after/group-into-container), §8.6 tabbed
// inspector (Content / Choices / Design tokens / Validation / Dependencies /
// Mapping placeholder / Advanced + the §8.5 container prop controls).
//
// Slice D2 (this file, second pass) ships: §8.2 Activity/Vertical dropdowns
// (E1: /activities + /verticals?activity=, "+ New …" behind the explicit
// confirm; E9 exact empty state + save-time zero-match warning), the §8.7
// Offer mapping panel (E2: Offer·Provider·Placement·schema-version·required/
// mapped·status table over GET /sections/:id/offers answer_fields; map-fields
// grid with path/question PICKERS, create-question-for-field, bulk-map with a
// review list, per-offer validate-payload preview, §6.3 deep links), the
// §8.6 inspector Mapping tab quick-map, and the §8.9/§9.1 events panel (the
// preview iframe loads the REAL runtime bundle with data-lg-preview="1"; the
// would-fire events arrive by postMessage). §8.8 Maps field-level UI stays a
// later slice.
//
// v2.5 redesign, Section Studio WAVE 1 of 2 (contract-v2.5 05/07/08/02):
// §5.1 Question strip (canonical headline/subheadline editors + Continue
// behavior + frame note + hidden-in-unit chips), §5.2 headline binding UX
// (bound-node seeding for NEW Sections, strip⇄canvas⇄inspector ONE store,
// palette bound inserts + disable tooltip, legacy link banner — both cases,
// delete→chip→[Show] re-insert), §5.4 unit-only canvas scope (Frame hint
// skeleton toggle + the amber page-frame badge with a DISABLED/pending Move
// affordance), §8.3 intent-first palette groups + Quote-Builder callout + C7
// trust scope note, §7.1–§7.4 scope-aware inspector (scope header + pills +
// aria-live retarget, DYNAMIC per-selection tabs, operator-word relabeling,
// consequence-inline rename copy, Advanced-only ids/bind marker + the §7.5
// console-only section_advanced_opened event), A5 image_alt sample fixes and
// the A6 image_fit component prop (Design-tab control).
// WAVE 2 (this file, shipped): the §6 canvas-toolbar contract (§6.1 anatomy
// 1–9: clickable breadcrumb crumbs, toolbar-hosted scope pills (ONE pill
// implementation with the inspector, §6.1.2), REQUIRED undo/redo (≥30-step
// in-memory history per open editor, cleared on Save, ⌘Z/⇧⌘Z), canvas
// viewport toggle (server-rendered `viewport` param), structure cluster
// (+ Group→Grid/Columns + Ungroup splice), layout/text/component clusters,
// §6.6 named presets over KV `lg-component-presets` with the Design-tab
// saved-presets dropdown), §6.5 context matrix (pure toolbarClustersFor),
// §6.2 canvas interaction (dblclick inline text editing, per-choice
// selection, inline choice ops, width-preset resize snap, Del/Esc keys),
// §6.4 choice cluster, §5.4 Move-to-funnel-layout semantics (single-funnel
// confirm naming the funnel → real PUT /funnels/:id/frame + node removal
// persisted on the same action; used-by-many → funnel picker), §5.3 mode 5
// Preview-with-funnel-layout (frame picker + site selector → the landed
// sections/preview frame_context param; exact empty-state copy), §5.5 choice
// depth (per-choice icon/emoji/image picker cells, title/subtitle/badge/
// disabled/aria_label, bulk paste label = value, searchable-dropdown toggle),
// §7.3 C1 Choices separation (NO provider-value control; the read-only
// "Provider values: k/n Offers" chip over the DEV-55 per-offer projection),
// §9.4 Design-tab role swatch rows (role-name values, inheritance source
// line, Reset to inherited, legacy-hex Convert affordance), §9.5 Section
// role-overrides drawer mode, and the Advanced raw-JSON read-only view with
// the explicit "Edit raw…" confirm.
//
// House rules carried over from ui-question-builder: ONE strict-ES5 inline
// island (no arrow/const/let/async/await/backtick — the layout.ts constraint,
// asserted by the ES5 parse test); bootstrap data rides
// <script type="application/json"> blobs (`<`-escaped); every author value is
// escapeHtml-escaped; the PREVIEW renders into a sandboxed srcdoc iframe.
// The CANVAS renders into its OWN same-origin srcdoc iframe as well (DEV-66
// routed fix): an inline parent-document region can never re-evaluate the
// design's @media rules, so the mobile block of funnelChromeCss NEVER fired
// in a wide admin window even when the Mobile toggle server-rendered the
// mobile wrap. The frame document is a REAL viewport (Desktop 1280 / Mobile
// 375 — §6.1.4 semantics, the ui-quotes canvas idiom), the markup inside is
// still OUR OWN preset render (parity by construction), and the island
// re-binds the §6.2 canvas delegation onto iframe.contentDocument
// (sandbox="allow-same-origin allow-scripts"; script execution is killed by
// the srcdoc's OWN first-in-head CSP meta script-src 'none' — NOT by the
// sandbox, which now grants allow-scripts precisely so Chromium delivers
// held-button page.mouse streams across the frame boundary, the U13 dead-drag
// fix; the ui-quotes onCanvasClick idiom), so every selection hit-target keeps
// working.
//
// Save path is UNCHANGED from the old island: POST /sections (new) or PATCH
// /sections/:id with {section_name, activity, vertical, headline_text,
// subheadline_text, continue_mode, address_validation_enabled, content_json,
// answer_maps} — answer_maps pass through untouched until the D2 §8.7 panel.

import { escapeHtml } from "../templates/layout";
import { COMPONENT_CATALOG, type ComponentType } from "../../public/leadgen/components/registry";
import {
  COLOR_TYPED_OVERRIDE_KEYS,
  LEADGEN_BG_PANEL_BACKGROUNDS,
  LEADGEN_BG_PANEL_GRADIENTS,
  LEADGEN_COLUMN_MOBILE_MODES,
  LEADGEN_COLUMN_RATIOS,
  LEADGEN_FIELD_ACCEPT_FORMATS,
  LEADGEN_FIELD_LEADING_ICONS,
  LEADGEN_GAP_TOKENS,
  LEADGEN_GRID_SIZINGS,
  LEADGEN_MAX_CONTAINER_DEPTH,
  LEADGEN_NODE_BORDER_COLOR_ROLES,
  LEADGEN_NODE_CORNERS,
  LEADGEN_PANEL_BACKGROUNDS,
  LEADGEN_PANEL_PADDINGS,
  LEADGEN_PANEL_RADII,
  LEADGEN_PANEL_SHADOWS,
  LEADGEN_PANEL_WIDTHS,
  LEADGEN_SIZE_HEIGHT_PRESETS,
  LEADGEN_SIZE_WIDTH_PRESETS,
  LEADGEN_SPACER_VARIANTS,
  LEADGEN_STACK_ALIGNS,
  LEADGEN_STACK_DIRECTIONS,
  LEADGEN_TEXT_BLOCK_ROLES,
  REQUIRED_FIELDS,
  isLayoutContainerType,
  validateSectionContent,
  type LeadgenComponentNode,
  type LeadgenSectionContent,
  type RequiredSpec,
} from "../../public/leadgen/components/content-schema";
import { renderComponent, renderSectionComponents } from "../../public/leadgen/components/presets";
// v2.5 09 §9.1/§9.4/§9.5: the 14 semantic roles + the resolved role→value
// table (swatch chips, legacy-hex Convert matching) ride the studio meta blob.
import { FUNNEL_TOKEN_ROLES, resolveTokens } from "../../public/leadgen/designs/theme";
import { FUNNEL_DESIGNS, getFunnelDesign, type FunnelDesign } from "../../public/leadgen/designs/registry";
import {
  FUNNEL_DESIGN_SCOPE_ATTR,
  funnelChromeCss,
} from "../../public/leadgen/designs/default-funnel/styles";
// v3.1 §3 design tokens — the ONLY color/type/spacing/radius/geometry values
// the re-chromed shell may use; sourced here so the Gate-1b token audit can
// verify every computed style traces to this single module (contract §13).
import { STUDIO_COLOR, STUDIO_GEOMETRY, STUDIO_RADIUS, STUDIO_TYPE } from "./studio-tokens";

// ---------------------------------------------------------------------------
// §5 component library (golden 102-258) — 4 intent-first groups of TILES
// (not raw catalog types). Each tile's SVG is copied VERBATIM from the golden
// (Appendix D asset, 46×30 viewBox); data-name carries the exact §5.5
// synonym string (search key). defaultType is the §5.6 concrete type a
// click/keyboard/drag insert creates; childTypes (Contact only) makes that
// insert a 3-node Stack. This REPLACES the v2.5 six-group/43-type/live-
// thumbnail palette (§5.1: "no thumbnails-of-text", §5.3: primitives replace
// one-off blocks) — the retired one-off types remain fully supported on the
// CANVAS (existing content renders + primitiveViewOfNode/
// rewriteRetiredNodeToPrimitive migrate them, Phase-A content-schema.ts) —
// they are simply no longer separately PLACEABLE from the palette.
// ---------------------------------------------------------------------------

interface StudioTile {
  dataName: string;
  label: string;
  defaultType: ComponentType;
  childTypes?: readonly ComponentType[];
  svg: string;
  // additive (m2, adversarial review): initial props for tiles whose insert
  // needs more than a bare default-typed node — e.g. the Divider tile shares
  // Spacer's defaultType with the Layout group's own Spacer tile, but must
  // insert with variant:"line" so it renders a visible rule, not a bare gap.
  defaultProps?: Readonly<Record<string, string>>;
}

interface StudioGroup {
  key: string;
  label: string;
  tiles: readonly StudioTile[];
  defaultOpen: boolean;
  // §5.2 / Appendix A / golden :145: a right-aligned group-header subcopy —
  // only the Answer-fields group carries one ("how visitors answer").
  subcopy?: string;
}

// The 20 verbatim golden tile SVGs (Appendix D: "data-tile data-name='…' —
// one block per §5.5 synonym string; the SVG inside each block is the
// tile's asset"). Copied byte-for-byte from the committed golden master —
// never redrawn or re-spaced by eye.
const TILE_SVG = {
  shortText:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="4" y="8.5" width="38" height="13" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.5"/><line x1="9" y1="11.5" x2="9" y2="18.5" stroke="#1B3A5C" stroke-width="1.5" stroke-linecap="round"/><line x1="13" y1="15" x2="27" y2="15" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/></svg>',
  buttons:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="6" y="4" width="34" height="9" rx="4.5" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.4"/><rect x="6" y="17" width="34" height="9" rx="4.5" fill="#fff" stroke="#9AA9BD" stroke-width="1.4"/></svg>',
  cards:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="5" y="5" width="16" height="9" rx="2" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.3"/><rect x="25" y="5" width="16" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><rect x="5" y="17" width="16" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><rect x="25" y="17" width="16" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/></svg>',
  continueButton:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="5" y="9" width="36" height="13" rx="6.5" fill="#1B3A5C"/><line x1="13" y1="15.5" x2="27" y2="15.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/><path d="M27 12l3.5 3.5-3.5 3.5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  yesNo:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="4" y="9" width="17" height="13" rx="6.5" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.3"/><rect x="25" y="9" width="17" height="13" rx="6.5" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><path d="M9 15.5l2.2 2.2 4-4.4" stroke="#1B3A5C" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 13l6 6M36 13l-6 6" stroke="#9AA9BD" stroke-width="1.3" stroke-linecap="round"/></svg>',
  dropdown:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="4" y="8.5" width="38" height="13" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.5"/><path d="M32 13l3 3 3-3" stroke="#1B3A5C" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="15" x2="25" y2="15" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/></svg>',
  multiSelect:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="6" y="6.5" width="8" height="8" rx="2" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.3"/><path d="M8 10.5l1.6 1.6 3-3.2" stroke="#1B3A5C" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="10.5" x2="38" y2="10.5" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/><rect x="6" y="18" width="8" height="8" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><line x1="18" y1="22" x2="34" y2="22" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/></svg>',
  number:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="4" y="8.5" width="38" height="13" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.5"/><text x="10" y="19" font-family="Inter" font-size="10" font-weight="700" fill="#1B3A5C">123</text></svg>',
  amount:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="4" y="8.5" width="38" height="13" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.5"/><text x="9" y="19" font-family="Inter" font-size="11" font-weight="800" fill="#1B3A5C">$</text><line x1="17" y1="15" x2="30" y2="15" stroke="#C2CCDA" stroke-width="1.8" stroke-linecap="round"/></svg>',
  date: '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="8" y="6" width="30" height="18" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.4"/><line x1="8" y1="12" x2="38" y2="12" stroke="#1B3A5C" stroke-width="1.4"/><line x1="15" y1="4" x2="15" y2="8" stroke="#1B3A5C" stroke-width="1.4" stroke-linecap="round"/><line x1="31" y1="4" x2="31" y2="8" stroke="#1B3A5C" stroke-width="1.4" stroke-linecap="round"/><rect x="12" y="15" width="4" height="4" rx="1" fill="#1B3A5C"/></svg>',
  slider:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><line x1="6" y1="15" x2="40" y2="15" stroke="#C2CCDA" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="15" x2="24" y2="15" stroke="#1B3A5C" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="15" r="5" fill="#fff" stroke="#1B3A5C" stroke-width="1.6"/></svg>',
  contact:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><circle cx="13" cy="11" r="4.5" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.3"/><path d="M6 24c0-4 4-6 7-6s7 2 7 6" fill="none" stroke="#1B3A5C" stroke-width="1.3" stroke-linecap="round"/><line x1="25" y1="10" x2="40" y2="10" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><line x1="25" y1="16" x2="40" y2="16" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><line x1="25" y1="22" x2="35" y2="22" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/></svg>',
  address:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><path d="M14 5c4 0 6 3 6 6 0 4-6 11-6 11S8 15 8 11c0-3 2-6 6-6z" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.3"/><circle cx="14" cy="11" r="2" fill="#1B3A5C"/><line x1="25" y1="11" x2="40" y2="11" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><line x1="25" y1="17" x2="36" y2="17" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/></svg>',
  text: '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><text x="5" y="19" font-family="Newsreader,serif" font-size="15" font-weight="600" fill="#1B3A5C">Aa</text><line x1="26" y1="10" x2="41" y2="10" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><line x1="26" y1="16" x2="41" y2="16" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><line x1="26" y1="22" x2="35" y2="22" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/></svg>',
  image:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="6" y="5" width="34" height="20" rx="3" fill="#fff" stroke="#1B3A5C" stroke-width="1.4"/><circle cx="14" cy="12" r="2.4" fill="#F5C518"/><path d="M9 23l7-7 5 5 4-4 6 6" fill="none" stroke="#1B3A5C" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  divider:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><line x1="5" y1="15" x2="18" y2="15" stroke="#9AA9BD" stroke-width="1.7" stroke-linecap="round"/><circle cx="23" cy="15" r="1.7" fill="#9AA9BD"/><line x1="28" y1="15" x2="41" y2="15" stroke="#9AA9BD" stroke-width="1.7" stroke-linecap="round"/></svg>',
  card: '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="5" y="3" width="36" height="24" rx="4" fill="#fff" stroke="#1B3A5C" stroke-width="1.4"/><line x1="11" y1="10" x2="35" y2="10" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><line x1="11" y1="15" x2="30" y2="15" stroke="#C2CCDA" stroke-width="1.7" stroke-linecap="round"/><rect x="11" y="19" width="14" height="4" rx="2" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1"/></svg>',
  columns:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="6" y="5" width="15" height="20" rx="3" fill="#EAF0F6" stroke="#1B3A5C" stroke-width="1.3"/><rect x="25" y="5" width="15" height="20" rx="3" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/></svg>',
  grid: '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="6" y="5" width="15" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><rect x="25" y="5" width="15" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><rect x="6" y="17" width="15" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/><rect x="25" y="17" width="15" height="9" rx="2" fill="#fff" stroke="#9AA9BD" stroke-width="1.3"/></svg>',
  spacer:
    '<svg width="46" height="30" viewBox="0 0 46 30" fill="none"><rect x="6" y="5" width="34" height="20" rx="3" fill="none" stroke="#9AA9BD" stroke-width="1.3" stroke-dasharray="3 3"/><path d="M23 9v12M20 12l3-3 3 3M20 18l3 3 3-3" stroke="#1B3A5C" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const;

// §5.2 groups & tiles (exact order, contract table). Suggested's 4 tiles are
// the SAME insert semantics as their Answer-fields/Content counterparts —
// never a separate catalog (contract: "a shortcut row").
const TILE_SHORT_TEXT: StudioTile = { dataName: "short text", label: "Short text", defaultType: "FreeTextQuestion", svg: TILE_SVG.shortText };
const TILE_BUTTONS: StudioTile = { dataName: "buttons", label: "Buttons", defaultType: "ButtonAnswerGroup", svg: TILE_SVG.buttons };
const TILE_CARDS: StudioTile = { dataName: "cards", label: "Cards", defaultType: "IconCardAnswerGrid", svg: TILE_SVG.cards };
const TILE_CONTINUE: StudioTile = { dataName: "continue button", label: "Continue", defaultType: "ContinueButton", svg: TILE_SVG.continueButton };

export const STUDIO_LIBRARY_GROUPS: readonly StudioGroup[] = [
  {
    key: "suggested",
    label: "Suggested",
    defaultOpen: true,
    tiles: [TILE_SHORT_TEXT, TILE_BUTTONS, TILE_CARDS, TILE_CONTINUE],
  },
  {
    key: "answer-fields",
    label: "Answer fields",
    defaultOpen: true,
    subcopy: "how visitors answer",
    tiles: [
      TILE_BUTTONS,
      TILE_CARDS,
      { dataName: "yes no", label: "Yes / No", defaultType: "TwoButtonYesNo", svg: TILE_SVG.yesNo },
      { dataName: "dropdown", label: "Dropdown", defaultType: "DropdownQuestion", svg: TILE_SVG.dropdown },
      { dataName: "multi-select", label: "Multi-select", defaultType: "MultiChoiceCardGroup", svg: TILE_SVG.multiSelect },
      TILE_SHORT_TEXT,
      { dataName: "number", label: "Number", defaultType: "NumberInputQuestion", svg: TILE_SVG.number },
      { dataName: "amount money", label: "Amount", defaultType: "CurrencyInputQuestion", svg: TILE_SVG.amount },
      { dataName: "date", label: "Date", defaultType: "DateQuestion", svg: TILE_SVG.date },
      { dataName: "slider scale", label: "Slider", defaultType: "NumberRangeQuestion", svg: TILE_SVG.slider },
      {
        dataName: "contact name email phone",
        label: "Contact",
        defaultType: "Stack",
        childTypes: ["NameFieldsGroup", "EmailInputQuestion", "PhoneInputQuestion"],
        svg: TILE_SVG.contact,
      },
      { dataName: "address zip location", label: "Address", defaultType: "AddressAutocompleteQuestion", svg: TILE_SVG.address },
    ],
  },
  {
    key: "content",
    label: "Content",
    defaultOpen: true,
    tiles: [
      { dataName: "text legal note reassurance disclosure", label: "Text", defaultType: "TextBlock", svg: TILE_SVG.text },
      { dataName: "image logo picture", label: "Image / Logo", defaultType: "ImageBlock", svg: TILE_SVG.image },
      // §5.6: Divider inserts Spacer(line) — the "line" variant prop
      // (additive; content-schema.ts LEADGEN_SPACER_VARIANTS + the presets.ts
      // renderSpacer branch, adversarial review m2) renders a visible center
      // rule, distinguishing it from the Layout group's own bare-gap Spacer
      // tile even though both share defaultType "Spacer".
      { dataName: "divider line", label: "Divider", defaultType: "Spacer", defaultProps: { variant: "line" }, svg: TILE_SVG.divider },
    ],
  },
  {
    key: "layout",
    label: "Layout",
    defaultOpen: false,
    tiles: [
      { dataName: "card panel", label: "Card", defaultType: "CardPanel", svg: TILE_SVG.card },
      { dataName: "columns", label: "Columns", defaultType: "Columns", svg: TILE_SVG.columns },
      { dataName: "grid", label: "Grid", defaultType: "GridContainer", svg: TILE_SVG.grid },
      { dataName: "spacer gap", label: "Spacer", defaultType: "Spacer", svg: TILE_SVG.spacer },
    ],
  },
];

// §8.3 plain name + one-line "use when" description per type. Display names
// and quoted descriptions follow the 08 §8.3 table VERBATIM where given;
// frame-scope types keep operator labels (they are no longer placeable, but
// legacy nodes still need operator words for the scope header / breadcrumb /
// badge). C6: no "slide" anywhere on this surface.
const STUDIO_TYPE_META: Record<ComponentType, { label: string; description: string }> = {
  ProgressBar: { label: "Progress bar", description: "Step or percent progress across the funnel." },
  HeaderLogo: { label: "Header logo", description: "Brand logo slot for the funnel header." },
  BackButton: { label: "Back / Previous", description: "Returns the visitor to the previous question." },
  DisclosureLink: { label: "Disclosure link", description: "Expandable legal / advertiser disclosure." },
  StepIndicator: { label: "Step indicator", description: "Multi-step dot indicator with current step." },
  CategoryLabel: { label: "Category label", description: "Uppercase kicker above the question headline." },
  QuestionHeadline: { label: "Question headline", description: "The main question copy of this Section." },
  Subheadline: { label: "Subheadline", description: "Supporting copy under the headline." },
  HelperText: { label: "Helper text", description: "Small reassurance / hint line near a field." },
  RangeQuestion: { label: "Slider", description: "Numeric slider between min and max." },
  CurrencyRangeQuestion: { label: "Amount slider", description: "Currency-formatted slider (loan amounts)." },
  NumberRangeQuestion: { label: "Slider", description: "Plain numeric slider variant." },
  ButtonAnswerGroup: { label: "Simple answer buttons", description: "One-tap answer choices." },
  TwoButtonYesNo: { label: "Yes / No", description: "Yes / No pair storing a boolean answer." },
  IconCardAnswerGrid: { label: "Icon answer cards", description: "Use when each answer has an icon." },
  ImageCardAnswerGrid: { label: "Image answer cards", description: "Use when each answer has a logo or photo." },
  MultiChoiceCardGroup: { label: "Multi-select cards", description: "Select several cards (min/max bounded)." },
  DropdownQuestion: { label: "Dropdown", description: "Single-select dropdown of choices." },
  SearchableDropdownQuestion: { label: "Searchable dropdown", description: "Dropdown with a client-side search box." },
  OtherGroupSelector: { label: "Main + “Other” choices", description: "Main choices as buttons plus an Other panel." },
  FreeTextQuestion: { label: "Text", description: "Single-line free text input." },
  NumberInputQuestion: { label: "Number", description: "Plain numeric input (not a slider)." },
  CurrencyInputQuestion: { label: "Amount ($)", description: "Currency-prefixed plain input." },
  EmailInputQuestion: { label: "Email", description: "Email input with format validation." },
  // v3.1 R3b E1-C6: "with format validation" was inaccurate — the renderer
  // never consumed a format prop (registry.ts hygiene note).
  PhoneInputQuestion: { label: "Phone", description: "Phone number input." },
  NameFieldsGroup: { label: "Name", description: "First + last name field pair." },
  DateQuestion: { label: "Date", description: "Date input with an allowed range." },
  ZIPInputQuestion: { label: "ZIP", description: "5-digit ZIP input (Maps validation optional)." },
  AddressAutocompleteQuestion: { label: "Address", description: "Street address with Places autocomplete." },
  ContinueButton: { label: "Continue button", description: "Validates the question unit, then continues." },
  AutoAdvanceButton: { label: "Auto-advance", description: "Advances immediately on answer click." },
  ReassuranceBadge: { label: "Reassurance badge", description: "Reassurance line inside this question unit." },
  SuccessState: { label: "Success state", description: "Completion panel with heading + message." },
  SecureFormBadge: { label: "Secure-form badge", description: "Lock badge naming the form security." },
  TrustBar: { label: "Trust points", description: "Icon/text trust pairs, horizontal or stacked." },
  LogoStrip: { label: "Logo row", description: "Carrier / partner logo row." },
  // v3.1 R3b E2-C5: clarified so an operator doesn't mistake this preview
  // copy for the actual message a visitor will see.
  ValidationError: { label: "Error message line", description: "Static fallback message — the live funnel replaces this with the real validation error." },
  LegalNote: { label: "Legal note", description: "Small-print legal copy block." },
  Stack: { label: "Stack", description: "Vertical/horizontal token-gap grouping." },
  GridContainer: { label: "Answer grid", description: "Per-breakpoint column grid container." },
  Columns: { label: "Two columns", description: "Two-column ratio preset with mobile stacking." },
  CardPanel: { label: "Question card", description: "The centered question card container." },
  BackgroundPanel: { label: "Background panel", description: "Full-background panel with token fill." },
  Spacer: { label: "Spacer", description: "Token-sized vertical gap." },
  HeaderBar: { label: "Header bar", description: "Header slot: logo, back, secure, call CTA." },
  FooterBar: { label: "Footer bar", description: "Footer slot: legal, trust messages, links." },
  // v3.1 05 §5.3 Text/Image primitives (conductor fix round — catalog
  // lockstep). Operator-worded labels per contract §5.2's palette-tile
  // names verbatim ("Text", "Image / Logo"); descriptions name the roles/
  // source modes they consolidate. TRANSITIONAL placement — Phase B's
  // palette rebuild lands these in a proper "Content" group with a real
  // role/source picker; today they render + validate + save correctly but
  // are reachable only via the existing Question-copy/Trust groups below.
  TextBlock: { label: "Text", description: "Heading, body copy, category label, helper, legal, or a trust badge — pick a role." },
  ImageBlock: { label: "Image / Logo", description: "A single image, or your site's logo (auto-fill)." },
};

// ---------------------------------------------------------------------------
// §8.3 sample nodes — thumbnails render FROM THE COMPONENT'S OWN PRESET with
// these sample props (never hand-drawn). Product-code sibling of the test
// suite's NODE_SPECS idiom.
// ---------------------------------------------------------------------------

const SAMPLE_CHOICES = [
  { label: "Yes, currently", value: "yes", analytics_id: "smp_yes" },
  { label: "Not yet", value: "no", analytics_id: "smp_no" },
];
const SAMPLE_ICON_CHOICES = SAMPLE_CHOICES.map((c) => ({ ...c, icon: "★" }));
// A5: image-card sample choices ALWAYS carry image_alt next to imageMediaId —
// §8.4 makes image_alt REQUIRED when imageMediaId is present on an
// ImageCardAnswerGrid choice, so alt-less samples would fail save validation.
const SAMPLE_IMAGE_CHOICES = SAMPLE_CHOICES.map((c) => ({ ...c, imageMediaId: "media_sample", image_alt: c.label }));

export const STUDIO_SAMPLE_NODES: Record<ComponentType, LeadgenComponentNode> = {
  ProgressBar: { type: "ProgressBar", question_id: "smp", props: { mode: "percent", percent: 60 } },
  HeaderLogo: { type: "HeaderLogo", question_id: "smp", props: { logoMediaId: "media_logo", siteName: "Acme", accent: "Quotes" } },
  BackButton: { type: "BackButton", question_id: "smp", props: { label: "Back" } },
  DisclosureLink: { type: "DisclosureLink", question_id: "smp", props: { panelHtml: "Advertiser disclosure" } },
  StepIndicator: { type: "StepIndicator", question_id: "smp", props: { steps: 4, current: 2 } },
  CategoryLabel: { type: "CategoryLabel", question_id: "smp", props: { text: "AUTO INSURANCE" } },
  QuestionHeadline: { type: "QuestionHeadline", question_id: "smp", props: { text: "Are you currently insured?" } },
  Subheadline: { type: "Subheadline", question_id: "smp", props: { text: "This helps us match carriers." } },
  HelperText: { type: "HelperText", question_id: "smp", props: { text: "We never share this." } },
  RangeQuestion: { type: "RangeQuestion", question_id: "smp", internal_field: "smp_amount", props: { min: 0, max: 100, default: 60 } },
  CurrencyRangeQuestion: { type: "CurrencyRangeQuestion", question_id: "smp", internal_field: "smp_loan", props: { min: 10000, max: 1000000, default: 330000, currency: "$" } },
  NumberRangeQuestion: { type: "NumberRangeQuestion", question_id: "smp", internal_field: "smp_count", props: { min: 1, max: 9, default: 3 } },
  ButtonAnswerGroup: { type: "ButtonAnswerGroup", question_id: "smp", internal_field: "smp_pick", choices: SAMPLE_CHOICES },
  TwoButtonYesNo: { type: "TwoButtonYesNo", question_id: "smp", internal_field: "smp_insured", props: { yesLabel: "Yes", noLabel: "No" } },
  IconCardAnswerGrid: { type: "IconCardAnswerGrid", question_id: "smp", internal_field: "smp_biz", choices: SAMPLE_ICON_CHOICES, props: { columns: 2 } },
  ImageCardAnswerGrid: { type: "ImageCardAnswerGrid", question_id: "smp", internal_field: "smp_carrier", choices: SAMPLE_IMAGE_CHOICES, props: { columns: 2 } },
  MultiChoiceCardGroup: { type: "MultiChoiceCardGroup", question_id: "smp", internal_field: "smp_features", choices: SAMPLE_CHOICES, props: { min: 1, max: 2 } },
  DropdownQuestion: { type: "DropdownQuestion", question_id: "smp", internal_field: "smp_insurer", choices: SAMPLE_CHOICES, props: { placeholder: "Pick one" } },
  SearchableDropdownQuestion: { type: "SearchableDropdownQuestion", question_id: "smp", internal_field: "smp_make", choices: SAMPLE_CHOICES, props: { placeholder: "Search…" } },
  OtherGroupSelector: {
    type: "OtherGroupSelector",
    question_id: "smp",
    internal_field: "smp_other",
    choices: SAMPLE_CHOICES,
    choiceDisplay: { mainValues: ["yes"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false },
  },
  FreeTextQuestion: { type: "FreeTextQuestion", question_id: "smp", internal_field: "smp_note", props: { placeholder: "Type here…" } },
  NumberInputQuestion: { type: "NumberInputQuestion", question_id: "smp", internal_field: "smp_age", props: { min: 18, max: 99, placeholder: "Your age" } },
  CurrencyInputQuestion: { type: "CurrencyInputQuestion", question_id: "smp", internal_field: "smp_income", props: { currency: "$", placeholder: "Annual income" } },
  EmailInputQuestion: { type: "EmailInputQuestion", question_id: "smp", internal_field: "smp_email", props: { placeholder: "you@example.com" } },
  PhoneInputQuestion: { type: "PhoneInputQuestion", question_id: "smp", internal_field: "smp_phone", props: { placeholder: "(555) 000-0000" } },
  NameFieldsGroup: { type: "NameFieldsGroup", question_id: "smp" },
  DateQuestion: { type: "DateQuestion", question_id: "smp", internal_field: "smp_dob" },
  ZIPInputQuestion: { type: "ZIPInputQuestion", question_id: "smp", internal_field: "smp_zip", props: { placeholder: "ZIP code" } },
  AddressAutocompleteQuestion: { type: "AddressAutocompleteQuestion", question_id: "smp", props: { provider: "google", placeholder: "Street address" } },
  ContinueButton: { type: "ContinueButton", question_id: "smp", props: { label: "Continue", loadingLabel: "Working…" } },
  AutoAdvanceButton: { type: "AutoAdvanceButton", question_id: "smp", props: { label: "Next" } },
  ReassuranceBadge: { type: "ReassuranceBadge", question_id: "smp", props: { text: "Get your offers in 2 minutes or less." } },
  SuccessState: { type: "SuccessState", question_id: "smp", props: { heading: "All set", message: "We found offers for you.", icon: "✓" } },
  SecureFormBadge: { type: "SecureFormBadge", question_id: "smp", props: { text: "256-bit SSL encrypted" } },
  TrustBar: { type: "TrustBar", question_id: "smp", props: { items: [{ icon: "🔒", text: "SSL secured" }, { icon: "★", text: "4.8 rating" }], layout: "horizontal" } },
  LogoStrip: { type: "LogoStrip", question_id: "smp", props: { logos: [{ mediaId: "media_1", alt: "Acme" }, { mediaId: "media_2", alt: "Globex" }] } },
  ValidationError: { type: "ValidationError", question_id: "smp", props: { text: "This field is required" } },
  LegalNote: { type: "LegalNote", question_id: "smp", props: { html: "Terms and conditions apply." } },
  Stack: {
    type: "Stack",
    question_id: "smp",
    props: { direction: "vertical", gap: "s", align: "stretch" },
    children: [
      { type: "QuestionHeadline", question_id: "smp_c1", props: { text: "Stacked content" } },
      { type: "ContinueButton", question_id: "smp_c2", props: { label: "Continue" } },
    ],
  },
  GridContainer: {
    type: "GridContainer",
    question_id: "smp",
    props: { columnsDesktop: 2, columnsTablet: 2, columnsMobile: 1, gap: "s", sizing: "equal" },
    children: [
      { type: "ReassuranceBadge", question_id: "smp_c1", props: { text: "Fast" } },
      { type: "ReassuranceBadge", question_id: "smp_c2", props: { text: "Free" } },
    ],
  },
  Columns: {
    type: "Columns",
    question_id: "smp",
    props: { ratio: "60/40", mobile: "stack" },
    children: [
      { type: "Subheadline", question_id: "smp_c1", props: { text: "Left column" } },
      { type: "Subheadline", question_id: "smp_c2", props: { text: "Right column" } },
    ],
  },
  CardPanel: {
    type: "CardPanel",
    question_id: "smp",
    props: { width: "m", background: "card", shadow: "md", radius: "lg", padding: "m" },
    children: [{ type: "QuestionHeadline", question_id: "smp_c1", props: { text: "Centered card" } }],
  },
  BackgroundPanel: {
    type: "BackgroundPanel",
    question_id: "smp",
    props: { gradient: "primary" },
    children: [{ type: "QuestionHeadline", question_id: "smp_c1", props: { text: "On a background" } }],
  },
  Spacer: { type: "Spacer", question_id: "smp", props: { size: "l" } },
  HeaderBar: {
    type: "HeaderBar",
    question_id: "smp",
    props: { logoMediaId: "media_logo", logoAlt: "Acme", back: true, secure: true, cta: { label: "Call now", tel: "+1 800 555 1212" } },
  },
  FooterBar: {
    type: "FooterBar",
    question_id: "smp",
    props: { legalHtml: "Terms apply.", trustMessages: ["SSL secured"], links: [{ label: "Privacy", href: "/privacy" }] },
  },
  // v3.1 05 §5.3 Text/Image primitives — sample nodes for the thumbnail
  // render (renderLibraryItem calls renderComponent on these directly).
  TextBlock: { type: "TextBlock", question_id: "smp", props: { role: "body", text: "Supporting copy for this question." } },
  ImageBlock: { type: "ImageBlock", question_id: "smp", props: { source: "auto_logo", siteName: "Acme", accent: "Quotes" } },
};

// ---------------------------------------------------------------------------
// Per-type inspector projections (Content tab copy fields + Validation tab
// numeric/text rules) — derived by reading what each preset consumes.
// ---------------------------------------------------------------------------

// Content-tab prop keys per type (display copy the §8.6 Content tab edits).
// `helper` is the CANONICAL per-node helper-line key (contract §8.1/§11.3,
// Phase-A schema). v3.1 audit-round G FIX 3b renamed it from the pre-fix
// `helper_text` (which the golden/contract never named); legacy v2.5 sections
// may still carry props.helper_text — inspectorFieldValue read-falls-back to
// it on load and the save rewrite migrates it to props.helper (erratum 8).
const CONTENT_PROP_FIELDS: Record<ComponentType, readonly string[]> = {
  ProgressBar: ["label"],
  HeaderLogo: ["logoMediaId"],
  BackButton: ["label"],
  // v3.1 R3 MINOR-6 (register E2-NEW-8): DisclosureLink is a FRAME-SCOPE type
  // (FRAME_SCOPE_STUDIO_TYPES) — selecting it renders the read-only "edited in
  // the Quote Builder" notice, which SUPERSEDES this content-prop projection,
  // so these keys never reached an operator (dead projection). Emptied. The
  // html->panelHtml SAVE-REPAIR (migrateDisclosureLinkKey, at the save seam)
  // and the frame-scope strip both STAY — a legacy node still round-trips.
  DisclosureLink: [],
  StepIndicator: [],
  CategoryLabel: ["text"],
  QuestionHeadline: ["text"],
  Subheadline: ["text"],
  HelperText: ["text"],
  RangeQuestion: ["minLabel", "maxLabel", "helper"],
  CurrencyRangeQuestion: ["minLabel", "maxLabel", "currency", "helper"],
  NumberRangeQuestion: ["minLabel", "maxLabel", "helper"],
  ButtonAnswerGroup: ["helper"],
  TwoButtonYesNo: ["yesLabel", "noLabel", "helper"],
  IconCardAnswerGrid: ["helper"],
  ImageCardAnswerGrid: ["helper"],
  MultiChoiceCardGroup: ["helper"],
  DropdownQuestion: ["placeholder", "helper"],
  SearchableDropdownQuestion: ["placeholder", "helper"],
  OtherGroupSelector: ["helper"],
  // v3.1 §8.3 Basics: "Field label (only you see this)" (node.props.label,
  // NEW — §11.3) is NOT listed here for the 8 Accept-swappable text-input
  // types — the generic CONTENT_CONTROLS "label" row's shared text ("Label")
  // is wrong for them (ContinueButton's "label" means "Button label"; a text
  // field's means "Field label"). The Content tab renders a DEDICATED
  // "Field label" input for the Accept-swappable family instead (still
  // `data-inspector-field="label"` — the generic populate/collect loop reads
  // any matching element regardless of which markup rendered it), gated by
  // `acceptFormatOfNode(node) !== null`, so there is no double-registration.
  FreeTextQuestion: ["placeholder", "helper"],
  NumberInputQuestion: ["placeholder", "helper"],
  CurrencyInputQuestion: ["placeholder", "currency", "helper"],
  EmailInputQuestion: ["placeholder", "helper"],
  PhoneInputQuestion: ["placeholder", "helper"],
  // v3.1 R3b E1-NEW-7: firstLabel/lastLabel are ALREADY consumed by the
  // renderer (renderNameFieldsGroup) but had no authoring control at all.
  NameFieldsGroup: ["firstLabel", "lastLabel", "helper"],
  DateQuestion: ["placeholder", "helper"],
  ZIPInputQuestion: ["placeholder", "helper"],
  AddressAutocompleteQuestion: ["placeholder", "helper"],
  // v3.1 R3 MINOR-4 (register E2-NEW-6 AMENDED): §8.4 lists ONLY "Button label",
  // so loadingLabel is OUT-OF-CONTRACT — no authoring control. The renderer
  // still CONSUMES a legacy stored loadingLabel (presets.ts:1615, render-only).
  ContinueButton: ["label"],
  AutoAdvanceButton: ["label"],
  ReassuranceBadge: ["text", "icon"],
  SuccessState: ["heading", "message", "icon"],
  SecureFormBadge: ["text", "icon"],
  TrustBar: [],
  LogoStrip: [],
  ValidationError: ["text"],
  LegalNote: ["html"],
  Stack: [],
  GridContainer: [],
  Columns: [],
  CardPanel: [],
  BackgroundPanel: [],
  Spacer: [],
  HeaderBar: [],
  FooterBar: [],
  // v3.1 05 §5.3/§8.5b — Text's `role` picker is a STYLE-tab control per the
  // contract (§8.5b: "Text / bound headline ... Style tab shows: Role
  // [Heading·Body·...]"), not Content tab, so it is intentionally absent
  // here; `text`/`icon` mirror the retired ReassuranceBadge/SecureFormBadge
  // content_props this primitive consolidates.
  TextBlock: ["text", "icon"],
  // v3.1 R3b deliverable 4: ImageBlock is EMPTY here (not the generic bare-
  // input path) — its source toggle / alt text / media-picker-with-thumbnail
  // are a dedicated block (data-content-imageblock-block, gated to
  // node.type==='ImageBlock') built for this phase; see renderStudioInspector.
  ImageBlock: [],
};

// The union of content controls the Content tab server-renders once; the
// island shows only the selected type's keys (CONTENT_PROP_FIELDS projection).
const CONTENT_CONTROLS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "text", label: "Text" },
  { key: "label", label: "Label" },
  { key: "yesLabel", label: "Yes label" },
  { key: "noLabel", label: "No label" },
  { key: "placeholder", label: "Placeholder" },
  { key: "helper", label: "Helper text" },
  { key: "heading", label: "Heading" },
  { key: "message", label: "Message" },
  { key: "icon", label: "Icon (emoji / glyph)" },
  { key: "html", label: "Rich text / legal copy" },
  { key: "panelHtml", label: "Disclosure text" },
  { key: "minLabel", label: "Min label" },
  { key: "maxLabel", label: "Max label" },
  { key: "currency", label: "Currency symbol" },
  // v3.1 R3 MINOR-4: loadingLabel control removed (out-of-contract, §8.4).
  { key: "logoMediaId", label: "Logo media id" },
  { key: "firstLabel", label: "First name label" },
  { key: "lastLabel", label: "Last name label" },
];

interface ValidationField {
  key: string;
  kind: "number" | "text";
}

// Validation-tab rule inputs per type (§8.6: min/max for numeric types,
// maxLen/pattern for free text; DateQuestion min/max are date STRINGS).
const VALIDATION_PROP_FIELDS: Partial<Record<ComponentType, readonly ValidationField[]>> = {
  RangeQuestion: [{ key: "min", kind: "number" }, { key: "max", kind: "number" }, { key: "step", kind: "number" }],
  CurrencyRangeQuestion: [{ key: "min", kind: "number" }, { key: "max", kind: "number" }, { key: "step", kind: "number" }],
  NumberRangeQuestion: [{ key: "min", kind: "number" }, { key: "max", kind: "number" }, { key: "step", kind: "number" }],
  NumberInputQuestion: [{ key: "min", kind: "number" }, { key: "max", kind: "number" }, { key: "step", kind: "number" }],
  CurrencyInputQuestion: [{ key: "min", kind: "number" }, { key: "max", kind: "number" }],
  MultiChoiceCardGroup: [{ key: "min", kind: "number" }, { key: "max", kind: "number" }],
  FreeTextQuestion: [{ key: "maxLen", kind: "number" }],
  DateQuestion: [{ key: "min", kind: "text" }, { key: "max", kind: "text" }],
};

// §6.5 pattern-preset vocabulary for free text (stored as props.pattern_preset
// + props.pattern for `custom` — authoring metadata the runtime leg can adopt).
const PATTERN_PRESETS = ["none", "letters", "digits", "custom"] as const;

// ---------------------------------------------------------------------------
// Palette seed templates — SAME blob id + shape as the old editor
// (#lg-component-seeds) so the authoring bootstrap contract is unchanged.
// ---------------------------------------------------------------------------

function seedTemplateForType(type: ComponentType): Record<string, unknown> {
  const entry = COMPONENT_CATALOG[type];
  const props = entry.props as readonly string[];
  const seed: Record<string, unknown> = {};
  let hasChoices = false;
  for (const prop of props) {
    if (prop === "internal_field") seed["internal_field"] = "";
    else if (prop === "required") seed["required"] = false;
    else if (prop.indexOf("choices") === 0) hasChoices = true;
  }
  if (hasChoices) seed["choices"] = [];
  if (entry.produces !== null) seed["answer_type"] = entry.produces;
  return seed;
}

export function componentSeedTemplates(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const type of Object.keys(COMPONENT_CATALOG) as ComponentType[]) {
    out[type] = seedTemplateForType(type);
  }
  return out;
}

// The island-side per-type metadata: container flag, produces, choice-bearing,
// the REQUIRED_FIELDS projection (drives the live validation chip + makeNode
// validity defaults), the Content-tab keys and Validation-tab rule inputs.
// `maps` is the §8.8 field-level Google-Maps config mode: only the two
// Maps-capable question types get the inspector Maps tab (browser Places leg
// only — Q5: the server geocode leg stays out of authoring scope).
export interface StudioTypeMetaBlob {
  label: string;
  // v3.1 §8.1 "what it is" one-line description — the SAME catalog copy the
  // library tiles use server-side; the inspector scope header (island-side
  // scopeWhatItIs) falls back to this for any selection outside the 3
  // contract-asserted fixture rows (ZIP field / headline / continue).
  description: string;
  container: boolean;
  layout: boolean;
  // The type has a Layout-tab structured-prop group (data-container-group):
  // the §8.5 containers/leaves plus the structured-prop affordance/chrome
  // leaves (TrustBar/LogoStrip/StepIndicator). Drives island tab visibility.
  layout_props: boolean;
  // v2.5 08 §8.2 scope (frame|unit|both) — drives the §5.4 amber page-frame
  // badge on legacy canvas nodes + the frame-node inspector tab gating.
  scope: "frame" | "unit" | "both";
  produces: string | null;
  choice: boolean;
  maps: "address" | "zip" | null;
  required: {
    internal_field: boolean;
    choices: boolean;
    choice_icon: boolean;
    choice_image: boolean;
    text_props: readonly string[];
    numeric_props: readonly string[];
  };
  content_props: readonly string[];
  validation: readonly ValidationField[];
}

export function studioTypeMeta(): Record<string, StudioTypeMetaBlob> {
  const out: Record<string, StudioTypeMetaBlob> = {};
  for (const type of Object.keys(COMPONENT_CATALOG) as ComponentType[]) {
    const spec: RequiredSpec = REQUIRED_FIELDS[type];
    out[type] = {
      label: STUDIO_TYPE_META[type].label,
      description: STUDIO_TYPE_META[type].description,
      container: isLayoutContainerType(type),
      layout: COMPONENT_CATALOG[type].category === "layout",
      layout_props: STRUCTURED_PROP_TYPES.has(type),
      scope: COMPONENT_CATALOG[type].scope,
      produces: COMPONENT_CATALOG[type].produces,
      choice: spec.choices === true,
      maps: type === "AddressAutocompleteQuestion" ? "address" : type === "ZIPInputQuestion" ? "zip" : null,
      required: {
        internal_field: spec.internalField === true,
        choices: spec.choices === true,
        choice_icon: spec.choiceIcon === true,
        choice_image: spec.choiceImage === true,
        text_props: spec.textProps ?? [],
        numeric_props: spec.numericProps ?? [],
      },
      content_props: CONTENT_PROP_FIELDS[type],
      validation: VALIDATION_PROP_FIELDS[type] ?? [],
    };
  }
  return out;
}

function jsonBlob(id: string, payload: unknown): string {
  return `<script type="application/json" id="${id}">${JSON.stringify(payload).replace(/</g, "\\u003c")}</script>`;
}

// §9.1 role → operator label (the UI Label column, verbatim). Locksteps with
// FUNNEL_TOKEN_ROLES via the Record type — a new role fails the compile.
export const STUDIO_ROLE_LABELS: Record<(typeof FUNNEL_TOKEN_ROLES)[number], string> = {
  brand_primary: "Brand primary",
  brand_secondary: "Brand secondary",
  accent: "Accent",
  success: "Success",
  error: "Error",
  page_background: "Page background",
  card_background: "Card background",
  surface_wash: "Soft fill",
  border: "Border",
  text_primary: "Text",
  text_muted: "Muted text",
  button_primary_bg: "Button",
  button_primary_text: "Button text",
  button_secondary_bg: "Secondary button",
};

// The two studio bootstrap blobs: the legacy-shaped seed templates + the new
// studio metadata (max depth rides along so the island never hardcodes it).
// Wave 2 additions: the 14 §9.1 roles with labels + the DEFAULT design's
// resolved role values (swatch chips; exact-match Convert for legacy hex).
export function renderStudioSeedData(): string {
  const resolved = resolveTokens(getFunnelDesign(null), null, null);
  return (
    jsonBlob("lg-component-seeds", componentSeedTemplates()) +
    jsonBlob("lg-studio-meta", {
      max_depth: LEADGEN_MAX_CONTAINER_DEPTH,
      types: studioTypeMeta(),
      roles: resolved.roles,
      role_labels: STUDIO_ROLE_LABELS,
      // v3.1 R3 S2-5/6c: the 12 §8.1 leading-icon options (value+label), so the
      // choice-editor icon picker reuses the SAME curated list as the leading-
      // icon field — no drift, single source (LEADGEN_FIELD_LEADING_ICONS).
      leading_icons: LEADGEN_FIELD_LEADING_ICONS.map((v) => ({ value: v, label: LEADING_ICON_LABELS[v] })),
    })
  );
}

// ---------------------------------------------------------------------------
// §8.1 top bar + the settings strip (scalar fields the save path needs)
// ---------------------------------------------------------------------------

export interface StudioSectionView {
  public_id: string | null; // null = new section
  section_name: string;
  status: string;
  activity: string;
  vertical: string;
  headline_text: string;
  subheadline_text: string | null;
  continue_mode: string;
  address_validation_enabled: boolean;
  content: LeadgenSectionContent;
}

// §5.2 (D1/F1): NEW Sections seed content_json with a BOUND QuestionHeadline
// + a BOUND Subheadline as nodes 1–2 — the strip inputs and these canvas
// nodes are ONE store (headline_text / subheadline_text), two views. Consumed
// by ui-sections.ts for BOTH the /new SSR view and the #lg-section-data blob
// (so the island model matches the server render byte-for-byte).
export function seededNewSectionContent(): LeadgenSectionContent {
  return {
    components: [
      { type: "QuestionHeadline", question_id: "q_bound_headline", bind: "section_headline" },
      { type: "Subheadline", question_id: "q_bound_subheadline", bind: "section_subheadline" },
    ],
  };
}

// Structural twin of ui-question-builder's MappingSummary (kept local so the
// studio never imports from the file it replaces).
export interface StudioMappingSummary {
  publishable: boolean;
  status: "ok" | "error";
  required_missing_total: number;
  // v3.1 §4.1 additive: the top-bar badge reads "Mapping k / n complete" —
  // k = required_mapped_total, n = required_fields_total (summed across every
  // available Offer). The golden fixture hardcodes "2 / 2"; the real UI
  // computes the true counts in the identical format (§0 fidelity-vs-function).
  required_mapped_total: number;
  required_fields_total: number;
}

// R5 D7 (register S4-B4): golden's "No issues" chip (golden :49-52) is a
// rounded-RECT (8px = STUDIO_RADIUS.control, not the shared .studio-chip
// pill radius) carrying a leading info-glyph icon — copied VERBATIM from the
// golden's own <svg> (circle + vertical line + dot), stroke="currentColor" so
// it always matches whichever text color the issue-count state resolves to
// (muted for zero, warn for non-zero — colors unchanged, both already
// measured 1:1 from golden per the existing STUDIO_COLOR.issuesChipBg/
// STUDIO_COLOR.muted comments).
const ISSUE_CHIP_ICON =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" style="flex:0 0 auto"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="16.5" r="1.2" fill="currentColor"/></svg>';
function issueChip(count: number): string {
  const label = count === 1 ? "1 issue" : `${count} issues`;
  return `<button type="button" class="studio-chip studio-chip-validation" data-studio-validation-chip data-issue-count="${count}" aria-live="polite" style="display:inline-flex;align-items:center;gap:6px;border-radius:${STUDIO_RADIUS.control}px">${ISSUE_CHIP_ICON}${escapeHtml(count === 0 ? "No issues" : label)}</button>`;
}

// The §8.1 top bar. §8.2 (Slice D2): Activity/Vertical are DROPDOWNS — the
// island feeds Activity from GET /activities and Vertical from
// GET /verticals?activity=<sel> (changing Activity resets Vertical); no free
// text by default — the "+ New activity…"/"+ New vertical…" affordances
// require the explicit "No Offers exist for '<x>' yet" confirm. The SSR
// select carries only the saved value so a legacy value never breaks; element
// ids stay lg-section-activity / lg-section-vertical so collectSection + the
// dirty watcher carry over unchanged. The mapping badge stays LIVE: once the
// offers panel loads (and on every mapping edit after), updateMappingBadge()
// recomputes the SAME Appendix-A "Mapping k / n complete" text this SSR
// render shows, from the identical field-count source (adversarial review
// M1 fixed a prior divergence where the client clobbered this element with
// the §8.1 offers-panel's OWN, differently-scoped "N/M Offers complete"
// wording — that phrase belongs to the drawer/offers-panel context only).
// Shared select-option-with-saved-value helper — Activity/Vertical selects
// live in the §4.2 question strip now (renderStudioSettings); Save/Archive
// forms may grow more selects later, so this stays a module-level helper.
// R5 D5 (register S4-A8/B8): the empty option is a STYLED placeholder pill
// (data-pair-empty on the wrapper, styled below), never the literal
// "— pick —" glyph-dash copy the golden never depicts. `placeholder` names
// the field so Activity/Vertical each get a distinct, readable hint.
function savedOption(value: string, placeholder: string): string {
  return value === ""
    ? `<option value="" selected>${escapeHtml(placeholder)}</option>`
    : `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>`;
}

export function renderStudioTopBar(
  view: StudioSectionView,
  summary: StudioMappingSummary,
  statusPillHtml: string,
  initialIssueCount: number,
): string {
  const isNew = view.public_id === null;
  // v3.1 §4.1: literal format "Mapping k / n complete" (golden :47 hardcodes
  // its fixture's "2 / 2"; the real UI computes true k/n — §0 fidelity-vs-
  // function). Green only when k===n (contract: "green when k=n").
  const mappingComplete = summary.required_fields_total > 0 && summary.required_mapped_total === summary.required_fields_total;
  const mappingBadgeColor = mappingComplete ? STUDIO_COLOR.success : STUDIO_COLOR.muted;
  const mappingBadgeBg = mappingComplete ? STUDIO_COLOR.successTintAlt : STUDIO_COLOR.issuesChipBg;
  const mappingBadge = `<span class="studio-chip studio-chip-mapping" data-studio-mapping-badge data-publishable="${summary.publishable}" data-mapping-complete="${mappingComplete}" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:${mappingBadgeColor};background:${mappingBadgeBg};padding:6px 11px;border-radius:${STUDIO_RADIUS.control}px">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4 10-11" stroke="${mappingBadgeColor}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Mapping ${summary.required_mapped_total} / ${summary.required_fields_total} complete
  </span>`;
  // §4.1 top bar (golden 29–57): Back · Section name (single store, inline
  // editable) · status pill · Mapping k/n badge · issues chip · Save ·
  // Archive. Activity/Vertical moved to the §4.2 question strip — SAME
  // element ids there, so collectSection + the dirty watcher are unaffected.
  return `<div class="studio-topbar" data-studio-topbar style="display:flex;align-items:center;gap:14px;height:${STUDIO_GEOMETRY.topBarHeight}px;padding:0 18px;background:${STUDIO_COLOR.white};border-bottom:1px solid ${STUDIO_COLOR.linePanel};flex-wrap:wrap">
  <a href="/admin/leadgen/sections" class="studio-back" style="display:flex;align-items:center;gap:7px;padding:7px 11px 7px 8px;border:1px solid ${STUDIO_COLOR.lineControl};border-radius:${STUDIO_RADIUS.control}px;cursor:pointer;color:${STUDIO_COLOR.text2Strong};font-weight:600;font-size:13px;text-decoration:none">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M14 6l-6 6 6 6" stroke="${STUDIO_COLOR.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Sections
  </a>
  <div style="width:1px;height:24px;background:${STUDIO_COLOR.linePanel}"></div>
  <div class="form-group studio-name" style="display:flex;flex-direction:column;gap:1px;margin:0">
    <label class="form-label" for="lg-section-name" style="font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:${STUDIO_COLOR.sectionEyebrow}">Section</label>
    <div style="display:flex;align-items:center;gap:9px">
      <input id="lg-section-name" name="section_name" required aria-required="true" value="${escapeHtml(view.section_name)}" style="width:132px;font-size:17px;font-weight:700;color:${STUDIO_COLOR.inkStrong};border:none;border-bottom:1.5px solid transparent;padding:1px 2px;outline:none;background:transparent" />
      ${isNew ? "" : statusPillHtml}
    </div>
  </div>
  <div style="margin-left:auto;display:flex;align-items:center;gap:12px">
    ${mappingBadge}
    ${issueChip(initialIssueCount)}
    <span class="studio-dirty-dot" data-studio-dirty-indicator data-dirty="false" role="status">Unsaved changes</span>
    <div style="width:1px;height:24px;background:${STUDIO_COLOR.linePanel}"></div>
    <button type="button" id="lg-section-save" class="studio-btn-save" style="padding:9px 20px;background:${STUDIO_COLOR.navy};color:${STUDIO_COLOR.white};font-weight:700;font-size:13px;border:0;border-radius:${STUDIO_RADIUS.control}px;cursor:pointer;box-shadow:0 1px 2px rgba(27,58,92,.28)">Save</button>
    <button type="button" id="lg-section-archive" class="studio-btn-archive"${isNew || view.status === "archived" ? " disabled" : ""} style="padding:9px 14px;background:transparent;border:0;color:${STUDIO_COLOR.archiveText};font-weight:600;font-size:13px;border-radius:${STUDIO_RADIUS.control}px;cursor:pointer">Archive</button>
  </div>
</div>`;
}

// §5.1 the "Question" strip (AMENDS v2.4 §8.1 settings form): the CANONICAL
// editors for headline_text / subheadline_text, the Continue-behavior radio
// (values unchanged: button/auto_advance) with the frame note, and the legacy
// global Maps checkbox row (compat — per-field config wins, unchanged). Same
// element ids as before so collectSection + the dirty watcher carry over.
// Each canonical input carries its §5.2 "Hidden in this question unit ·
// [Show]" chip (SSR'd hidden; the island shows it when the bound canvas node
// for that bind is deleted; [Show] re-inserts the bound node at the top).
// The strip never duplicates canvas content — the bound nodes and these
// inputs are ONE store, two views (§5.2).
// §4.2 "On answer" segmented — SSR mirror of the golden's seg() helper
// (golden :741-745), sourced from STUDIO_COLOR so Gate-1b traces the served
// bytes to §3. The ES5 island's segStyle() (below) hardcodes the identical
// literals for its post-click re-render, matching the golden's own idiom of
// hardcoded per-state style strings (Appendix D: "each returns the exact
// active/inactive inline-style strings").
function segStyle(active: boolean): string {
  return active
    ? `padding:5px 11px;font-size:12px;font-weight:700;color:${STUDIO_COLOR.navy};background:${STUDIO_COLOR.white};border-radius:6px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.12);white-space:nowrap`
    : `padding:5px 11px;font-size:12px;font-weight:600;color:${STUDIO_COLOR.mutedLabel};cursor:pointer;white-space:nowrap`;
}

// §6.1 canvas-toolbar viewport segmented — SSR mirror of the golden's
// vpSeg() helper (golden :751-755).
function vpSegStyle(active: boolean): string {
  return active
    ? `display:inline-flex;align-items:center;gap:6px;padding:5px 11px;font-size:12px;font-weight:700;color:${STUDIO_COLOR.navy};background:${STUDIO_COLOR.white};border-radius:6px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.12)`
    : `display:inline-flex;align-items:center;gap:6px;padding:5px 11px;font-size:12px;font-weight:600;color:${STUDIO_COLOR.faint};cursor:pointer`;
}

// §6.1 canvas-toolbar Frame-hint toggle — SSR mirror of the golden's
// frameBtnStyle/frameDotStyle (golden :840-845). Default ON (contract §6.1
// table + golden state.frameHint = true).
function frameBtnStyle(on: boolean): string {
  return on
    ? `display:inline-flex;align-items:center;gap:7px;padding:6px 11px;font-size:12px;font-weight:600;color:${STUDIO_COLOR.navy};background:${STUDIO_COLOR.navyTint};border-radius:7px;cursor:pointer`
    : `display:inline-flex;align-items:center;gap:7px;padding:6px 11px;font-size:12px;font-weight:600;color:${STUDIO_COLOR.faint};background:${STUDIO_COLOR.issuesChipBg};border-radius:7px;cursor:pointer`;
}
function frameDotStyle(on: boolean): string {
  return on
    ? `width:8px;height:8px;border-radius:50%;background:${STUDIO_COLOR.navy}`
    : `width:8px;height:8px;border-radius:50%;background:${STUDIO_COLOR.breadcrumbChevron}`;
}

// R5 census split (register §A M2 / E.5b "R3/R5 should split this function
// so the golden strip and the non-golden fieldset/pickers become
// independently classifiable blocks"): the Activity/Vertical pickers (S4-A8
// — moved here from the top bar in an earlier phase, no golden position
// exists for them) are their OWN top-level render* block below
// (renderActivityVerticalPickers) so golden-allowlist.mjs's block scanner
// can classify them separately from the golden-legit strip they render
// alongside. The legacy global Maps/validation fieldset this comment used to
// describe is GONE (see renderStudioSettings' own inline comment) — removing
// it was the OTHER half of this same census split; only the pickers remain
// as this function's non-golden content.
function renderActivityVerticalPickers(view: StudioSectionView): string {
  const dropdownChevron = (color: string): string =>
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `<div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;color:${STUDIO_COLOR.faint};font-weight:600">Activity</span>
      <div class="studio-pair" data-pair-empty="${view.activity === ""}" style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px 5px 10px;background:${view.activity === "" ? STUDIO_COLOR.issuesChipBg : STUDIO_COLOR.white};border:1px ${view.activity === "" ? "dashed" : "solid"} ${STUDIO_COLOR.lineControl};border-radius:7px;font-size:12.5px;font-weight:600">
        <select id="lg-section-activity" name="activity" data-studio-activity required aria-required="true" style="border:0;background:transparent;font:inherit;color:${view.activity === "" ? STUDIO_COLOR.faint : "inherit"};outline:none">${savedOption(view.activity, "Choose an activity")}</select>
        ${dropdownChevron(STUDIO_COLOR.faint)}
        <button type="button" class="studio-pair-new-btn" data-studio-new-activity title="Create a new activity" aria-label="Create a new activity" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:50%;background:${STUDIO_COLOR.issuesChipBg};color:${STUDIO_COLOR.faint};cursor:pointer;font-size:13px;line-height:1;padding:0">+</button>
      </div>
      <span style="font-size:11px;color:${STUDIO_COLOR.faint};font-weight:600;margin-left:4px">Vertical</span>
      <div class="studio-pair" data-pair-empty="${view.vertical === ""}" style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px 5px 10px;background:${view.vertical === "" ? STUDIO_COLOR.issuesChipBg : STUDIO_COLOR.white};border:1px ${view.vertical === "" ? "dashed" : "solid"} ${STUDIO_COLOR.lineControl};border-radius:7px;font-size:12.5px;font-weight:600">
        <select id="lg-section-vertical" name="vertical" data-studio-vertical required aria-required="true" style="border:0;background:transparent;font:inherit;color:${view.vertical === "" ? STUDIO_COLOR.faint : "inherit"};outline:none">${savedOption(view.vertical, "Choose a vertical")}</select>
        ${dropdownChevron(STUDIO_COLOR.faint)}
        <button type="button" class="studio-pair-new-btn" data-studio-new-vertical title="Create a new vertical" aria-label="Create a new vertical" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:50%;background:${STUDIO_COLOR.issuesChipBg};color:${STUDIO_COLOR.faint};cursor:pointer;font-size:13px;line-height:1;padding:0">+</button>
      </div>
    </div>`;
}

// §4.2 question strip (golden 59–97): row 1 = eyebrow "The question" ·
// Activity/Vertical dropdowns (renderActivityVerticalPickers above — MOVED
// here from the top bar in an earlier phase — same element ids so
// collectSection + the dirty watcher are unaffected) · "On answer" segmented
// [Wait for Continue | Go to next] (writes continue_mode) · Maps status chip
// (informational — §9's field Maps tab is the real control). Row 2 = the
// canonical Headline/Subheadline inputs (§5.2 single store) + the exact hint
// copy. The legacy global address-validation checkbox this strip used to
// carry is REMOVED (R5 D2, register S4-A2 — see the inline comment inside
// renderStudioSettings below); the only non-golden content remaining in
// THIS function is the Activity/Vertical picker group, now its own block.
export function renderStudioSettings(view: StudioSectionView, mapsKeyConfigured: boolean): string {
  const hiddenChip = (bind: "section_headline" | "section_subheadline"): string =>
    `<span class="studio-hidden-chip" data-bound-chip="${bind}" hidden style="display:inline-block;font-size:11px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:999px;padding:2px 8px;margin-top:4px">Hidden in this question unit &#183; <button type="button" class="studio-hidden-show" data-bound-show="${bind}" style="border:0;background:none;color:${STUDIO_COLOR.navy};cursor:pointer;font-size:11px;padding:0;text-decoration:underline">Show</button></span>`;
  const waitActive = view.continue_mode !== "auto_advance";
  return `<div class="studio-settings" data-studio-settings data-studio-question-strip style="padding:${STUDIO_GEOMETRY.questionStripPadding};background:${STUDIO_COLOR.stripBg};border-bottom:1px solid ${STUDIO_COLOR.lineStrip}">
  <div style="display:flex;align-items:center;gap:14px;margin-bottom:11px;flex-wrap:wrap">
    <span style="font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;color:${STUDIO_COLOR.questionEyebrow}">The question</span>
    ${renderActivityVerticalPickers(view)}
    <div style="margin-left:auto;display:flex;align-items:center;gap:16px">
      <div style="display:flex;align-items:center;gap:8px" title="The Continue button&#8217;s default style and position are set per funnel in the Quote Builder.">
        <span style="font-size:11px;color:${STUDIO_COLOR.faint};font-weight:600">On answer</span>
        <div data-continue-mode-group style="display:inline-flex;background:${STUDIO_COLOR.segmentTrack};border-radius:${STUDIO_RADIUS.control}px;padding:2px">
          <div data-continue-mode="button" role="button" tabindex="0" aria-pressed="${waitActive}" style="${segStyle(waitActive)}">Wait for Continue</div>
          <div data-continue-mode="auto_advance" role="button" tabindex="0" aria-pressed="${!waitActive}" style="${segStyle(!waitActive)}">Go to next</div>
        </div>
        <span class="form-help" data-continue-frame-note style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">The Continue button&#8217;s default style and position are set per funnel in the Quote Builder.</span>
      </div>
      <div data-maps-strip-chip style="display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:${STUDIO_COLOR.mutedLabel};background:${STUDIO_COLOR.mapsChipBg};border:1px solid ${STUDIO_COLOR.lineControl};padding:5px 10px;border-radius:20px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z" stroke="${STUDIO_COLOR.mutedLabel}" stroke-width="1.7"/><circle cx="12" cy="9" r="2.1" stroke="${STUDIO_COLOR.mutedLabel}" stroke-width="1.7"/></svg>
        Google Maps: ${mapsKeyConfigured ? "connected" : "not connected"}
      </div>
    </div>
  </div>
  <form id="lg-section-form" novalidate style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end">
    <div class="form-group" style="flex:1.5;margin:0">
      <label class="form-label" for="lg-section-headline" style="display:block;font-size:11px;font-weight:700;color:${STUDIO_COLOR.mutedLabel};margin-bottom:5px">Question headline *</label>
      <input id="lg-section-headline" name="headline_text" required aria-required="true" value="${escapeHtml(view.headline_text)}" style="width:100%;padding:10px 13px;font-size:15px;font-weight:600;color:${STUDIO_COLOR.ink};border:1px solid ${STUDIO_COLOR.stripInputBorder};border-radius:${STUDIO_RADIUS.control}px;outline:none;background:${STUDIO_COLOR.white}" />
      ${hiddenChip("section_headline")}
    </div>
    <div class="form-group" style="flex:1.2;margin:0">
      <label class="form-label" for="lg-section-subheadline" style="display:block;font-size:11px;font-weight:700;color:${STUDIO_COLOR.mutedLabel};margin-bottom:5px">Subheadline <span style="font-weight:500;color:${STUDIO_COLOR.sectionEyebrow}">&#183; optional</span></label>
      <input id="lg-section-subheadline" name="subheadline_text" value="${escapeHtml(view.subheadline_text ?? "")}" style="width:100%;padding:10px 13px;font-size:13.5px;color:${STUDIO_COLOR.text2Strong};border:1px solid ${STUDIO_COLOR.stripInputBorder};border-radius:${STUDIO_RADIUS.control}px;outline:none;background:${STUDIO_COLOR.white}" />
      ${hiddenChip("section_subheadline")}
    </div>
    <div style="flex:0 0 auto;padding-bottom:11px;font-size:11.5px;color:${STUDIO_COLOR.faintSub};display:flex;align-items:center;gap:6px;max-width:150px;line-height:1.35">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex:0 0 auto"><path d="M4 7l8 5 8-5" stroke="${STUDIO_COLOR.hintIconStroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 12v0" stroke="${STUDIO_COLOR.hintIconStroke}" stroke-width="1.8"/><path d="M4 6v8" stroke="${STUDIO_COLOR.hintIconStroke}" stroke-width="1.8" stroke-linecap="round"/></svg>
      Also shown on the canvas &#8212; edit in either place.
    </div>
    <!-- R5 D2 (register S4-A2): the legacy global Maps/validation fieldset is
         REMOVED — safe post-R4b (S3-8: both readers migrated to per-field
         precedence, proven in both the single- and mixed-multi-section
         case). No replacement control is needed: state.address_validation_
         enabled initializes from the #lg-section-data JSON blob (NOT from
         this DOM element — see the island's state = JSON.parse(...) at
         load) and collectSection() reads !!state.address_validation_enabled
         directly, so the value keeps round-tripping load -> save with NO
         DOM element at all. A field's own Maps tab (§9) is the real,
         current per-field mechanism; S3-8 proved it wins over this value
         when both are present. -->
  </form>
</div>
<div class="studio-bind-banner" data-bind-banner hidden role="status" aria-live="polite"></div>`;
}

// ---------------------------------------------------------------------------
// §8.3 component library (left rail)
// ---------------------------------------------------------------------------

// §5.1 tile (golden 114-247): the exact bespoke SVG over a name only — NO
// description, thumbnail-of-text, id string, or "maps to Offer fields"
// badge (§5.1 binding: "removed from the palette entirely... none may be
// added"). Tile padding/border/radius/hover from §5.1 + Appendix B, sourced
// from STUDIO_COLOR/STUDIO_RADIUS/STUDIO_GEOMETRY. The item wrapper stays a
// role="button" div (never <button> — nested interactive preset markup
// inside a real button is invalid HTML, the original D2 regression this
// idiom fixed; tiles no longer render live preset markup, but the div
// wrapper is kept for the same drag+keyboard+a11y contract).
function renderLibraryItem(tile: StudioTile): string {
  const childAttr = tile.childTypes ? ` data-add-children="${escapeHtml(tile.childTypes.join(","))}"` : "";
  // additive (m2): a tile whose insert needs starting props beyond a bare
  // default-typed node (the Divider's variant:"line") carries them JSON-
  // encoded. v3.1 audit-round G FIX 4: BOTH childTypes and defaultProps now
  // ride the drag 'add:' JSON envelope too, so a drag insert reproduces the
  // click/keyboard insert exactly (§5.6 determinism — no drag-drop degradation).
  const propsAttr = tile.defaultProps ? ` data-add-props="${escapeHtml(JSON.stringify(tile.defaultProps))}"` : "";
  return `<div class="studio-library-item" data-tile role="button" tabindex="0" draggable="true" data-add-component="${escapeHtml(tile.defaultType)}"${childAttr}${propsAttr} data-name="${escapeHtml(tile.dataName)}" aria-label="Add ${escapeHtml(tile.label)}" style="display:flex;flex-direction:column;align-items:center;gap:9px;padding:${STUDIO_GEOMETRY.tile.padding};border:1px solid ${STUDIO_COLOR.linePanel};border-radius:${STUDIO_RADIUS.tile}px;background:${STUDIO_COLOR.white};cursor:grab">
  ${tile.svg}
  <div class="studio-item-name" style="font-size:${STUDIO_TYPE.size.tileName}px;font-weight:600;color:${STUDIO_COLOR.text2}">${escapeHtml(tile.label)}</div>
</div>`;
}

// §5.2: the dismissible callout below the Layout group — page chrome lives
// in the Quote Builder. Dismissal persists in localStorage (island); [Open]
// deep-links the Quotes tab.
function renderFrameCallout(): string {
  return `<div class="studio-frame-callout" data-studio-frame-callout role="note" style="margin-top:16px;padding:12px 13px;background:${STUDIO_COLOR.infoBlueTint};border:1px solid ${STUDIO_COLOR.frameCalloutBorder};border-radius:9px">
  <div style="display:flex;align-items:flex-start;gap:9px">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" style="flex:0 0 auto;margin-top:1px"><rect x="3" y="4" width="18" height="16" rx="2" stroke="${STUDIO_COLOR.infoBlue}" stroke-width="1.8"/><path d="M3 9h18" stroke="${STUDIO_COLOR.infoBlue}" stroke-width="1.8"/></svg>
    <span class="studio-frame-callout-copy" style="font-size:12px;color:${STUDIO_COLOR.frameCalloutText};line-height:1.5">Header, footer, progress &amp; background belong to the whole funnel &#8212; set them once in the <strong>Quote Builder</strong>. <a href="/admin/leadgen/quotes" class="studio-frame-callout-open" data-studio-callout-open style="color:${STUDIO_COLOR.navy};font-weight:700;border-bottom:1px solid ${STUDIO_COLOR.frameCalloutLinkUnderline}">Open &#8594;</a></span>
    <button type="button" class="studio-frame-callout-dismiss" data-studio-callout-dismiss aria-label="Dismiss" style="border:0;background:none;cursor:pointer;font-size:14px;line-height:1;color:inherit;padding:0 2px">&#215;</button>
  </div>
</div>`;
}

// §5.2 / Appendix A / golden :220: the dashed-border explanatory callout that
// sits directly below the Content group's tiles. &amp;/&#8212; are the repo's
// entity forms (cf. renderFrameCallout / gate2 idiom). The bg #F6F8FB is a
// golden-sourced literal (no §3 token exists for it — Gate 1b's tier-3 golden
// allowance covers it); border/text/bold-Text trace to §3 tokens byte-exactly.
function renderContentCallout(): string {
  return `<div class="studio-content-callout" role="note" style="margin-top:9px;padding:9px 11px;background:#F6F8FB;border:1px dashed ${STUDIO_COLOR.contentDashedBorder};border-radius:8px;font-size:11.5px;color:${STUDIO_COLOR.contentDashedText};line-height:1.45">Legal notes, reassurance lines &amp; secure badges are just <b style="color:${STUDIO_COLOR.text2Strong};font-weight:700">Text</b> &#8212; pick a style in its settings. No separate blocks.</div>`;
}

// §5.1 group header: chevron (rotates 0→90° open, golden's chev() helper) +
// uppercase label; click toggles. Default open: Suggested/Answer fields/
// Content; default collapsed: Layout.
function chevronStyle(open: boolean): string {
  return `transform:rotate(${open ? 90 : 0}deg)`;
}

export function renderStudioLibrary(design: FunnelDesign, _content: LeadgenSectionContent): string {
  void design; // the tile SVGs are bespoke assets, independent of the active funnel design
  const groups = STUDIO_LIBRARY_GROUPS.map((group) => {
    const items = group.tiles.map(renderLibraryItem).join("");
    const callout =
      group.key === "layout" ? renderFrameCallout() : group.key === "content" ? renderContentCallout() : "";
    return `<div class="studio-library-group" data-library-group="${escapeHtml(group.key)}">
  <div class="studio-library-heading" data-library-group-toggle="${escapeHtml(group.key)}" role="button" tabindex="0" aria-expanded="${group.defaultOpen}" style="display:flex;align-items:center;gap:7px;padding:${STUDIO_GEOMETRY.groupHeaderPadding};cursor:pointer;user-select:none">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" style="${chevronStyle(group.defaultOpen)}"><path d="M8 5l8 7-8 7" stroke="${STUDIO_COLOR.hintIconStroke}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:${STUDIO_COLOR.faint}">${escapeHtml(group.label)}</span>${group.subcopy ? `<span class="studio-library-subcopy" style="margin-left:auto;font-size:11px;font-weight:600;color:${STUDIO_COLOR.answerFieldsSubcopy}">${escapeHtml(group.subcopy)}</span>` : ""}
  </div>
  <div class="studio-library-items" data-library-items="${escapeHtml(group.key)}"${group.defaultOpen ? "" : " hidden"} style="display:grid;grid-template-columns:1fr 1fr;gap:${STUDIO_GEOMETRY.tile.gap}px">${items}</div>
</div>${callout}`;
  }).join("");
  return `<div class="studio-library" data-studio-library aria-label="Component library">
  <div style="font-size:13px;font-weight:800;color:${STUDIO_COLOR.inkStrong};margin-bottom:11px">Add to this question</div>
  <div style="position:relative;margin-bottom:15px">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style="position:absolute;left:11px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="7" stroke="${STUDIO_COLOR.searchIconStroke}" stroke-width="2"/><path d="M20 20l-3.2-3.2" stroke="${STUDIO_COLOR.searchIconStroke}" stroke-width="2" stroke-linecap="round"/></svg>
    <input type="search" class="studio-library-search" data-studio-library-search placeholder="Search components" aria-label="Search components" style="width:100%;padding:9px 12px 9px 34px;font-size:13px;border:1px solid ${STUDIO_COLOR.lineControl};border-radius:${STUDIO_RADIUS.control}px;outline:none;background:${STUDIO_COLOR.searchInputBg};box-sizing:border-box" />
  </div>
  ${groups}
</div>`;
}

// ---------------------------------------------------------------------------
// §8.4 canvas (center)
// ---------------------------------------------------------------------------

// The same wrapper construction the preview endpoint emits (parity by
// construction): scoped chrome CSS + the desktop preview wrapper. The island
// re-renders this region from POST /sections/preview on every mutation.
// §5.2: the OPTIONAL sectionCtx resolves BOUND QuestionHeadline/Subheadline
// nodes to the Section's canonical columns (strip↔canvas one store) — the
// island's re-render sends the live strip values the same way (body.headline/
// body.subheadline → the preview handler's sectionCtx). continue_mode is NOT
// threaded here on purpose: the Build canvas keeps every authored control
// visible/selectable; the Preview drawer owns the §11.5 composition.
export function studioCanvasDocument(
  content: LeadgenSectionContent,
  design: FunnelDesign,
  ctx?: { headline_text: string; subheadline_text: string | null },
): string {
  const nodes = (Array.isArray(content.components) ? content.components : []).filter(
    (n): n is LeadgenComponentNode => typeof n === "object" && n !== null && typeof (n as { type?: unknown }).type === "string",
  );
  const rendered = renderSectionComponents(nodes, design, ctx);
  const css = funnelChromeCss(design, `[${FUNNEL_DESIGN_SCOPE_ATTR}="${design.id}"]`);
  return (
    `<style>${css}</style>` +
    `<div data-funnel-design="${design.id}" data-viewport="desktop" class="lg-preview lg-preview-desktop" style="max-width:${design.header.contentMaxWidth};margin:0 auto"><div class="lg-content">${rendered}</div></div>`
  );
}

// The canvas-frame document's OWN stylesheet (DEV-66): the decoration classes
// the island injects live INSIDE the srcdoc document now, so their rules must
// ride the frame shell — the admin page's stylesheet cannot reach into the
// iframe. Single source: these rules MOVED here from SECTION_STUDIO_STYLES
// (the parent page keeps only parent-side canvas chrome: surface, skeleton,
// empty state, frame sizing). The :root block pins the admin custom
// properties the rules consume; the minimal .btn set styles the §5.4 badge
// buttons the decoration pass creates.
// v3.1 audit-round G FIX 1: --c-primary is the golden's brand NAVY (§3 /
// golden :315/:330 canvas selection outline), NOT the pre-fix generic
// shell blue — the same root cause the chrome scope-override below closes.
export const SECTION_STUDIO_CANVAS_FRAME_CSS = `
:root{--c-primary:${STUDIO_COLOR.navy};--c-border:#e5e7eb;--c-muted:#6b7280;--c-surface:#fff}
html,body{margin:0;padding:0;background:#fff}
.studio-canvas-render [data-question-id]{cursor:pointer}
.studio-canvas-render .studio-selected-node{outline:2px solid var(--c-primary);outline-offset:2px;border-radius:4px}
.studio-canvas-render .studio-drop-before{box-shadow:0 -3px 0 0 var(--c-primary)}
.studio-canvas-render .studio-drop-after{box-shadow:0 3px 0 0 var(--c-primary)}
.studio-canvas-render .studio-drop-into{outline:2px dashed var(--c-primary);outline-offset:-2px}
/* §5.4 amber page-frame badge on legacy frame-scope canvas nodes */
.studio-frame-badge{font-size:11px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:4px 8px;margin:4px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.studio-frame-badge .btn{pointer-events:auto}
.studio-frame-badge-note{flex-basis:100%;font-size:10px;color:#664d03}
/* §8.8 linked-field chips */
.studio-maps-chip{display:inline-block;font-size:10px;color:#055160;background:#cff4fc;border:1px solid #b6effb;border-radius:999px;padding:1px 8px;margin:2px 0 0;pointer-events:none;user-select:none}
/* §6.2 inline canvas editing + per-choice decoration: selection ring, ghost
   tile, remove, resize */
.studio-canvas-render [contenteditable="true"]{outline:2px dashed var(--c-primary);outline-offset:2px;cursor:text}
.studio-choice-selected{outline:2px solid #e85d26 !important;outline-offset:2px}
.studio-choice-ghost{border:1px dashed var(--c-border);background:var(--c-surface);color:var(--c-muted);border-radius:8px;min-height:44px;cursor:pointer;font-size:12px}
.studio-choice-x{position:relative;border:0;background:#f8d7da;color:#842029;border-radius:999px;width:16px;height:16px;line-height:1;font-size:10px;cursor:pointer;margin-left:-14px;vertical-align:top}
.studio-resize-handle{position:absolute;right:-6px;top:50%;width:10px;height:32px;margin-top:-16px;border-radius:4px;background:var(--c-primary);opacity:.6;cursor:ew-resize}
/* §12.3 mapping-overlay chips */
.studio-mapoverlay-chip{font-size:10px;border-radius:999px;padding:2px 8px;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-muted);cursor:pointer;display:inline-block;margin:2px 0}
.studio-mapoverlay-chip[data-overlay-state="mapped"]{color:#0f5132;background:#d1e7dd;border-color:#badbcc}
.studio-mapoverlay-chip[data-overlay-state="required-missing"]{color:#842029;background:#f8d7da;border-color:#f5c2c7}
/* §5.4 move-to-frame funnel picker (renders inside the badge) */
.studio-funnel-picker{flex-basis:100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px}
/* minimal admin-button skin for the badge affordances inside the frame */
.btn{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--c-border);border-radius:6px;background:#fff;color:#111827;cursor:pointer}
.btn-sm{font-size:11px;padding:2px 8px}
.btn-outline{background:#fff}
.btn-danger{background:#dc2626;border-color:#dc2626;color:#fff}
`;

// §6.1.4 canvas srcdoc shell (DEV-66): a COMPLETE same-origin document whose
// body mounts the SAME #lg-studio-canvas-render region the island re-renders
// (the island replaces the mount's markup with style + html per render — the
// DOCUMENT persists, so the contentDocument delegation bound once per load
// survives every re-render). The initial content is the SSR
// studioCanvasDocument — the design css (funnelChromeCss WITH its @media
// mobile block) rides inside, so the mobile rules can genuinely fire once
// the frame is sized to 375.
export function studioCanvasFrameSrcdoc(
  content: LeadgenSectionContent,
  design: FunnelDesign,
  ctx?: { headline_text: string; subheadline_text: string | null },
): string {
  return (
    // U13 fix (2026-07-15): the CSP meta is emitted FIRST-in-head, right after
    // the charset meta and BEFORE the <style> — only our own fixed bytes
    // (doctype/html/head/charset) precede it; all user-derived content lands in
    // <body> below. script-src 'none' makes every script vector inert (inline
    // <script>, on* handler attrs, javascript: URLs) even though the iframe's
    // sandbox now grants allow-scripts — the scripting grant exists ONLY so
    // Chromium delivers held-button page.mouse streams across the srcdoc
    // boundary (the operator's dead-drag root cause), never to run page script.
    `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'"><style>${SECTION_STUDIO_CANVAS_FRAME_CSS}</style></head>` +
    `<body><div class="studio-canvas-render" id="lg-studio-canvas-render">${studioCanvasDocument(content, design, ctx)}</div></body></html>`
  );
}

// §6.3 "Frame hint" (golden 298-305 header / 360-365 footer): a dimmed
// (opacity .5), NON-interactive skeleton around the unit for spatial
// context — presentation-only, never editable here (the real frame is
// Quote-Builder-owned). Toggled by [data-studio-frame-hint]; default ON
// (contract §6.1 table + golden state.frameHint = true) — ships VISIBLE, not
// hidden. The exact golden copy ("Funnel frame", "brand·logo", the
// disclosure line) is Appendix A microcopy, not a generic gray-bar
// placeholder.
function renderFrameHintSkeleton(edge: "top" | "bottom"): string {
  const inner =
    edge === "top"
      ? `<div style="position:absolute;top:8px;left:0;display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:${STUDIO_COLOR.frameHintTagText};background:${STUDIO_COLOR.frameHintTagBg};padding:3px 8px;border-radius:${STUDIO_RADIUS.pill}px;pointer-events:auto"><svg width="10" height="10" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="9" rx="2" stroke="${STUDIO_COLOR.frameHintTagText}" stroke-width="2"/><path d="M8 11V8a4 4 0 018 0v3" stroke="${STUDIO_COLOR.frameHintTagText}" stroke-width="2"/></svg>Funnel layout</div>
    <div style="display:flex;justify-content:center;padding-top:18px"><div style="font-family:${STUDIO_TYPE.family.newsreader};font-size:19px;font-weight:600;color:${STUDIO_COLOR.frameCalloutText};letter-spacing:.3px">brand<span style="color:${STUDIO_COLOR.frameHintDot}">&#183;</span>logo</div></div>
    <div style="margin-top:14px;height:5px;border-radius:4px;background:${STUDIO_COLOR.frameHintProgressTrack};overflow:hidden"><div style="width:38%;height:100%;background:${STUDIO_COLOR.frameHintProgressFill}"></div></div>`
      : `<div style="font-size:11px;color:${STUDIO_COLOR.frameHintTagText};line-height:1.6">Advertising disclosure &#183; Terms &#183; Privacy<br>&#169; 2026 &#183; Trusted partner network</div>`;
  const wrapStyle =
    edge === "top"
      ? "position:relative;opacity:.5;pointer-events:none;padding:14px 0 20px"
      : "opacity:.5;pointer-events:none;padding:20px 0 8px;text-align:center";
  return `<div class="studio-frame-skeleton" data-studio-frame-skeleton="${edge}" aria-hidden="true" style="${wrapStyle}">${inner}</div>`;
}

// §6.1.2 / §7.1: ONE scope-pill implementation for BOTH hosts (toolbar +
// inspector scope header). The island updates every [data-scope-pill]
// instance document-wide, so the two hosts can never disagree.
export function renderScopePillsMarkup(): string {
  // MINOR 9: the "Funnel frame" pill DEEP-LINKS to the using funnel's Quote
  // Builder (the island enables it once usage loads; many funnels → a picker;
  // zero usage keeps it disabled). SSR ships it disabled — usage is not known
  // at render time.
  // v3.1 §8.1 (Appendix A "Inspector" — asserted verbatim): "This section" /
  // "This element" (NOT "This Section" / "Component" — a pre-v3.1 label this
  // phase corrects; the data-scope-pill VALUES are internal keys, unchanged).
  return `<div class="studio-scope-pills" role="group" aria-label="Editing scope">
    <button type="button" class="studio-scope-pill" data-scope-pill="frame" disabled title="The funnel layout (shared header, progress &amp; Continue) is edited in the Quote Builder">Funnel layout</button>
    <button type="button" class="studio-scope-pill active" data-scope-pill="section" aria-pressed="true">This section</button>
    <button type="button" class="studio-scope-pill" data-scope-pill="component" aria-pressed="false" disabled>This element</button>
    <button type="button" class="studio-scope-pill" data-scope-pill="choice" aria-pressed="false" disabled>Choice</button>
  </div>`;
}

// §9.4 role swatch select — the ONLY color vocabulary on normal surfaces:
// option VALUES are role names (writes land as roles, never hex); the empty
// option is the inherited state. Shared by the Design tab, the toolbar
// clusters and the §9.5 Section-overrides drawer.
function roleSelectOptions(): string {
  return FUNNEL_TOKEN_ROLES.map(
    (role) => `<option value="${escapeHtml(role)}">${escapeHtml(STUDIO_ROLE_LABELS[role])}</option>`,
  ).join("");
}

// R5 D3 (register S4-A3 removal): renderToolbarLayoutCluster/
// TOOLBAR_LAYOUT_TYPES (the canvas toolbar's "layout" cluster) DELETED — it
// was a DUPLICATE of renderContainerLayoutPanel (Style tab, R3b), which
// already renders the SAME container props over the SAME data-container-
// prop/data-container-group hooks for container types. The choice-grid
// columns/gap quick layout (formerly this function's own addition, not
// duplicated elsewhere) MOVED into the Style tab's size-appearance block —
// see renderStudioInspector's data-style-choice-layout.

// §5.6 "The Accept-swap rule" — exact enumeration (contract §8.5b): "Any
// text · Number · Amount ($) · Email · Phone · ZIP code (5 digits) · Date ·
// Street address (8; selecting swaps the node type per §5.6)". Values are
// LEADGEN_FIELD_ACCEPT_FORMATS (content-schema.ts, single source of truth);
// labels are asserted copy, defined here (the toolbar is this phase's only
// consumer — Phase C's inspector Accept dropdown will import the same
// LEADGEN_FIELD_ACCEPT_FORMATS values and may reuse or restate these labels).
const ACCEPT_LABELS: Record<(typeof LEADGEN_FIELD_ACCEPT_FORMATS)[number], string> = {
  text: "Any text",
  number: "Number",
  currency: "Amount ($)",
  email: "Email",
  phone: "Phone",
  us_zip: "ZIP code (5 digits)",
  date: "Date",
  street_address: "Street address",
};
const ACCEPT_OPTION_HTML = LEADGEN_FIELD_ACCEPT_FORMATS.map(
  (f) => `<option value="${f}">${escapeHtml(ACCEPT_LABELS[f])}</option>`,
).join("");

// R5 D3 (register S4-A3 migration): the 5-type "copy node" TYPE-SWAP —
// MIGRATED from the canvas toolbar into the Content tab's Answer-format-
// analogous "Type" row (isCopyNode selections only). Values are the actual
// component TYPES this select swaps between (island: convertTextRole); named
// "text type" here to avoid confusion with TextBlock's OWN internal `role`
// prop picker (Style tab, TEXT_BLOCK_ROLE_OPTION_HTML — a different axis).
const COPY_NODE_TYPE_SWAP: ReadonlyArray<{ value: string; label: string }> = [
  { value: "QuestionHeadline", label: "Headline" },
  { value: "Subheadline", label: "Subheadline" },
  { value: "CategoryLabel", label: "Kicker" },
  { value: "HelperText", label: "Helper" },
  { value: "LegalNote", label: "Legal" },
];
const COPY_NODE_TYPE_SWAP_OPTION_HTML = COPY_NODE_TYPE_SWAP.map(
  (r) => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`,
).join("");

// v3.1 §8.5b "Enumerations (exact, asserted)" — the 12-value leading-icon
// picker (Content tab, Basics). Values are LEADGEN_FIELD_LEADING_ICONS
// (content-schema.ts, single source of truth); labels are the asserted
// display copy (golden 452-453's worked example anchors "Location pin").
const LEADING_ICON_LABELS: Record<(typeof LEADGEN_FIELD_LEADING_ICONS)[number], string> = {
  location: "Location pin",
  calendar: "Calendar",
  dollar: "Dollar",
  phone: "Phone",
  email: "Email",
  lock: "Lock",
  person: "Person",
  home: "Home",
  car: "Car",
  shield: "Shield",
  star: "Star",
  none: "None",
};
const LEADING_ICON_OPTION_HTML = LEADGEN_FIELD_LEADING_ICONS.map(
  (v) => `<option value="${v}">${escapeHtml(LEADING_ICON_LABELS[v])}</option>`,
).join("");

// v3.1 §8.5b — the 7-value TextBlock `role` picker (Style tab, Text/bound
// headline selection). Values are LEADGEN_TEXT_BLOCK_ROLES (content-schema.ts).
const TEXT_BLOCK_ROLE_LABELS: Record<(typeof LEADGEN_TEXT_BLOCK_ROLES)[number], string> = {
  heading: "Heading",
  body: "Body",
  category_label: "Category label",
  helper: "Helper",
  legal: "Legal",
  reassurance: "Reassurance",
  secure_badge: "Secure badge",
};
const TEXT_BLOCK_ROLE_OPTION_HTML = LEADGEN_TEXT_BLOCK_ROLES.map(
  (v) => `<option value="${v}">${escapeHtml(TEXT_BLOCK_ROLE_LABELS[v])}</option>`,
).join("");

// v3.1 §8.5/§8.5b — Style tab Width/Height presets (segmented, §7.1) and the
// Corners/Border-color enums (node.design_overrides — Phase C addition,
// content-schema.ts). Segmented buttons reuse the existing btn/btn-sm/active
// idiom (viewport toggle, sim-state buttons) rather than new chrome.
const SIZE_WIDTH_LABELS: Record<(typeof LEADGEN_SIZE_WIDTH_PRESETS)[number], string> = {
  s: "S",
  m: "M",
  l: "L",
  full: "Full",
};
const SIZE_HEIGHT_LABELS: Record<(typeof LEADGEN_SIZE_HEIGHT_PRESETS)[number], string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};
const NODE_CORNERS_LABELS: Record<(typeof LEADGEN_NODE_CORNERS)[number], string> = {
  sharp: "Sharp",
  rounded: "Rounded",
  pill: "Pill",
};
const NODE_BORDER_COLOR_LABELS: Record<(typeof LEADGEN_NODE_BORDER_COLOR_ROLES)[number], string> = {
  neutral: "Neutral",
  brand: "Brand",
  accent: "Accent",
};

// §6.1 anatomy 1–9, left → right. The toolbar is ALWAYS visible (§6.5 row 1:
// nothing selected still shows breadcrumb(root) · pills · undo/redo ·
// viewport); the island toggles the per-selection clusters (pure
// toolbarClustersFor — the §6.5 matrix).
function renderCanvasToolbar(design: FunnelDesign): string {
  // min-height, not height: golden's 46px is the SINGLE-cluster bar (§6.5
  // matrix row 1 / the static mockup), but several selections (e.g. a
  // choice-bearing container) show TWO clusters simultaneously (structure +
  // component) — with flex-wrap, their combined width can exceed one row at
  // real viewport widths. A fixed height would clip/overflow those wrapped
  // rows UNDER the next sibling (the canvas surface), which then wins the
  // hit-test and swallows clicks meant for the overflowing buttons. A
  // min-height keeps golden's 46px look for every single-cluster selection
  // (the common case — identical rendered height) while letting the bar
  // grow, and the canvas correctly reflow below it, whenever it doesn't.
  // R5 D3 (register S4-A3, golden single-row toolbar): the canvas toolbar
  // is now golden's OWN ONE-ROW chrome model (breadcrumb/pills · undo/redo ·
  // viewport · frame hint · offer-mapping toggle · problems), plus ONE
  // compact "More actions" popover for the two genuinely toolbar-native
  // concerns the golden mockup doesn't depict AT ALL (structure actions:
  // move/reorder/group/delete a selection; choice-item quick actions: an
  // operator clicking a specific choice ON THE CANVAS). Every OTHER
  // per-selection cluster that used to balloon this row was either an exact
  // DUPLICATE of a control the Content/Style tab already owns (accept,
  // required, placeholder, "Validation…" [it only ever jumped to the
  // Content tab — never Rules — see the removed data-toolbar-open-validation
  // handler], +Add choice, Auto-advance, the layout/container props already
  // in renderContainerLayoutPanel, the text-color role already in the Style
  // tab's data-style-text-block) and is REMOVED (not migrated — nothing to
  // migrate, it already existed), or a genuine type-swap/style control that
  // belongs in an inspector tab and is MIGRATED there (searchable/card-style/
  // slider-format/text-type-swap → Content "Answer format"; selected-role +
  // preset apply/save + choice-grid columns/gap → Style tab). See
  // renderStudioInspector for the migrated destinations.
  return `<div class="studio-toolbar" data-studio-selection-toolbar data-studio-canvas-toolbar style="min-height:${STUDIO_GEOMETRY.canvasToolbarHeight}px;padding:0 16px;background:${STUDIO_COLOR.white};border-bottom:1px solid ${STUDIO_COLOR.linePanel};gap:12px">
    <nav class="studio-breadcrumb" data-studio-breadcrumb aria-live="polite" aria-label="Selection breadcrumb"></nav>
    ${renderScopePillsMarkup()}
    <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
      <span class="studio-tb-cluster" data-toolbar-cluster="undo" style="display:flex;align-items:center;gap:2px;border-left:0;padding:0">
        <button type="button" class="studio-undoredo-btn" data-studio-act="undo" disabled title="Undo (&#8984;Z)" aria-label="Undo"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M9 7L4 12l5 5" stroke="${STUDIO_COLOR.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 12h11a5 5 0 015 5v1" stroke="${STUDIO_COLOR.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button type="button" class="studio-undoredo-btn" data-studio-act="redo" disabled title="Redo (&#8679;&#8984;Z)" aria-label="Redo"><svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M15 7l5 5-5 5" stroke="${STUDIO_COLOR.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 12H9a5 5 0 00-5 5v1" stroke="${STUDIO_COLOR.muted}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </span>
      <div style="width:1px;height:22px;background:${STUDIO_COLOR.linePanel}"></div>
      <span class="studio-tb-cluster" data-toolbar-cluster="viewport" role="group" aria-label="Canvas viewport" style="display:inline-flex;background:${STUDIO_COLOR.segmentTrack};border-radius:${STUDIO_RADIUS.control}px;padding:2px;border-left:0">
        <button type="button" data-canvas-viewport="desktop" aria-pressed="true" style="${vpSegStyle(true)};border:0"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M9 20h6M12 16v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Desktop</button>
        <button type="button" data-canvas-viewport="mobile" aria-pressed="false" style="${vpSegStyle(false)};border:0"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Mobile</button>
      </span>
      <div style="width:1px;height:22px;background:${STUDIO_COLOR.linePanel}"></div>
      <button type="button" data-studio-frame-hint aria-pressed="true" title="Show the funnel layout around this section — the shared header, progress bar, Continue button &amp; footer. Set once per funnel in the Quote Builder." style="${frameBtnStyle(true)};border:0"><span style="${frameDotStyle(true)}"></span>Show funnel layout</button>
      <div style="width:1px;height:22px;background:${STUDIO_COLOR.linePanel}"></div>
      <!-- R4a E3-NEW-10: moved here from the Preview drawer panel — its
           handler repaints the CANVAS, so the control now lives where its
           effect is seen, always visible (not gated by tab/selection). -->
      <button type="button" class="btn btn-sm btn-outline" data-studio-overlay-toggle aria-pressed="false" title="Chip every answer component on the canvas with its Offer-mapping status">Offer mapping overlay</button>
      <div style="width:1px;height:22px;background:${STUDIO_COLOR.linePanel}"></div>
      <!-- R5 D3: the ONE compact popover replacing the old ballooning
           clusters — structure actions (the golden mockup has none at all;
           documented judgment call) + choice-item quick actions (operator
           clicks a choice ON THE CANVAS). Hidden entirely when the current
           selection has neither (updateCanvasToolbar). -->
      <button type="button" class="studio-tb-more-btn" data-studio-more-toggle aria-haspopup="true" aria-expanded="false" title="More actions for this selection" hidden style="width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;cursor:pointer;border:0;background:none;font-size:18px;line-height:1;color:${STUDIO_COLOR.muted}">&#8942;</button>
    </div>
    <div class="studio-tb-more-panel" data-studio-more-panel hidden style="position:absolute;right:16px;top:${STUDIO_GEOMETRY.canvasToolbarHeight}px;z-index:400;background:${STUDIO_COLOR.white};border:1px solid ${STUDIO_COLOR.lineControl};border-radius:${STUDIO_RADIUS.control}px;box-shadow:0 8px 24px rgba(16,24,40,.12);padding:8px;display:flex;flex-direction:column;gap:6px;min-width:180px">
      <span class="studio-tb-cluster" data-toolbar-cluster="structure" hidden style="display:flex;flex-direction:column;gap:2px">
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="move-up" aria-label="Move up">&#8593; Move up</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="move-down" aria-label="Move down">&#8595; Move down</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="add-before" aria-pressed="false">+ Before</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="add-after" aria-pressed="false">+ After</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="duplicate">Duplicate</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="group-stack">Group &#8594; Stack</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="group-cardpanel">Group &#8594; Card panel</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="group-grid">Group &#8594; Grid</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="group-columns">Group &#8594; Columns</button>
        <button type="button" class="btn btn-sm btn-outline" data-studio-act="ungroup">Ungroup</button>
        <button type="button" class="btn btn-sm btn-danger" data-studio-act="delete">Delete</button>
      </span>
      <span class="studio-tb-cluster" data-toolbar-cluster="choice" hidden style="display:flex;flex-direction:column;gap:2px">
        <span class="studio-chip" data-choice-value-chip title="Internal value — opens its Choices row" style="align-self:flex-start">value</span>
        <button type="button" class="btn btn-sm btn-outline" data-choice-act="image">Image / icon&#8230;</button>
        <button type="button" class="btn btn-sm btn-outline" data-choice-act="badge" aria-pressed="false">Badge</button>
        <button type="button" class="btn btn-sm btn-outline" data-choice-act="disabled" aria-pressed="false">Disabled</button>
        <button type="button" class="btn btn-sm btn-outline" data-choice-act="duplicate">Duplicate choice</button>
        <button type="button" class="btn btn-sm btn-outline" data-choice-act="left" aria-label="Move choice left">&#8592; Move left</button>
        <button type="button" class="btn btn-sm btn-outline" data-choice-act="right" aria-label="Move choice right">&#8594; Move right</button>
        <button type="button" class="btn btn-sm btn-danger" data-choice-act="delete">Delete choice</button>
      </span>
    </div>
    <span class="studio-toolbar-problems" data-toolbar-problems role="status" aria-live="polite" hidden></span>
  </div>`;
}

export function renderStudioCanvas(
  content: LeadgenSectionContent,
  design: FunnelDesign,
  ctx?: { headline_text: string; subheadline_text: string | null },
): string {
  const empty = !Array.isArray(content.components) || content.components.length === 0;
  // §2.2/§6.1 (golden: no separate "Canvas" heading row — the center column
  // starts directly with the 46px toolbar, which now hosts Frame hint too).
  return `<div class="studio-canvas" data-studio-canvas>
  ${renderCanvasToolbar(design)}
  <p class="studio-pending-note" data-studio-pending-note hidden role="status" aria-live="polite"></p>
  <p class="studio-refusal alert alert-error" data-studio-drop-refusal hidden role="status" aria-live="polite"></p>
  <div class="studio-canvas-surface" id="lg-studio-canvas" tabindex="0" aria-label="Section canvas — click a component to select; arrow keys reorder; Delete removes; Escape selects the parent">
    ${renderFrameHintSkeleton("top")}
    <iframe id="lg-studio-canvas-frame" class="studio-canvas-frame" title="Section canvas" sandbox="allow-same-origin allow-scripts" data-canvas-frame-viewport="desktop" srcdoc="${escapeHtml(studioCanvasFrameSrcdoc(content, design, ctx))}"></iframe>
    ${renderFrameHintSkeleton("bottom")}
    <div class="studio-canvas-empty" data-studio-canvas-empty${empty ? "" : " hidden"}><p>No components yet.</p><p class="form-help">Add a component from the library on the left, or drag one in.</p></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// §8.6 inspector (right) — tabs per selection
// ---------------------------------------------------------------------------

const CONDITION_OP_OPTIONS: ReadonlyArray<string> = ["eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in"];

// R4a S3-2: human words for the raw operator codes — SINGLE SOURCE for both
// the SSR <option> text below (opOptions) AND the island's own
// conditionSentence (interpolated into SECTION_STUDIO_SCRIPT as
// CONDITION_OP_LABELS, ~conditionSentence's definition) so neither surface
// invents its own wording. eq/neq already read as a full relation ("is" /
// "is not"); gt/lt/gte/lte/range/in/not_in are bare comparatives that
// conditionSentence prefixes with "is " at the sentence call site.
const CONDITION_OP_LABELS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  gt: "greater than",
  lt: "less than",
  gte: "at least",
  lte: "at most",
  range: "between",
  in: "one of",
  not_in: "not one of",
};

function options(values: readonly (string | number)[], labels?: readonly string[]): string {
  return values
    .map((v, i) => `<option value="${escapeHtml(String(v))}">${escapeHtml(labels ? labels[i] : String(v))}</option>`)
    .join("");
}

// §8.6 Design tab: curated token dropdowns ONLY — value lists projected from
// the active design's slots (colors from design.color, gaps from
// design.spacing, columns 2–5, mobile behavior = the Columns mobile modes).
// No free CSS anywhere; every select carries an "inherit" empty option.
interface TokenOption {
  value: string;
  label: string;
}

export function curatedTokenOptions(design: FunnelDesign): Record<string, TokenOption[]> {
  const c = design.color;
  const colorList: TokenOption[] = [
    { value: c.primary, label: "primary" },
    { value: c.primaryDark, label: "primary dark" },
    { value: c.primaryLight, label: "primary light" },
    { value: c.accent, label: "accent" },
    { value: c.accentHover, label: "accent hover" },
    { value: c.success, label: "success" },
    { value: c.error, label: "error" },
    { value: c.card, label: "card" },
    { value: c.border, label: "border" },
    { value: c.primaryWash, label: "primary wash" },
    { value: c.primaryGhost, label: "primary ghost" },
    { value: c.accentLight, label: "accent light" },
  ];
  const s = design.spacing;
  const gapList: TokenOption[] = [
    { value: s.xs, label: "xs" },
    { value: s.sm, label: "s" },
    { value: s.md, label: "m" },
    { value: s.lg, label: "l" },
    { value: s.xl, label: "xl" },
  ];
  return {
    iconColor: colorList,
    columns: [2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) })),
    featureColor: colorList,
    rangeColor: colorList,
    buttonBackground: colorList,
    buttonText: colorList,
    gridGap: gapList,
  };
}

// v3.1 R3b S2-7/S4-A4 (register-ruled removal): the old "§8.5 tokenized
// layout props" rail dumped EVERY CURATED_DESIGN_OVERRIDE_KEYS row behind one
// jargon paragraph, gated on the WRONG axis (shown for every 'field'-variant
// type regardless of whether that type's renderer ever reads the key).
// featureColor/buttonBackground/buttonText are GONE from this table — see
// their disposition below; only the genuinely-consumed, correctly-gated
// rows remain (iconColor/rangeColor/columns/gridGap).
const TOKEN_CONTROL_LABELS: Record<string, string> = {
  columns: "Card columns (2–5)",
  gridGap: "Answer-grid gap token",
};

// §9.4 operator labels for the COLOR-typed rows (role swatch rows — no
// "token" vocabulary on this surface).
const ROLE_CONTROL_LABELS: Record<string, string> = {
  iconColor: "Icon color",
  rangeColor: "Range fill",
};

// v3.1 R3b (renamed from renderDesignPanel — S2-7/S4-A4 rail removal; the
// golden-regions scan tracks blocks by NAME, so the rename is itself part of
// "drops renderDesignPanel from non-golden blocks"). Disposition of the OLD
// rail's 7 rows, per product logic (register S2-7 + E2-C1/E2-NEW-7):
//   - featureColor: DIED here — the Style tab's pre-existing "Text color
//     role" control (data-style-text-block) already covers every consumer
//     (E2-C1 wired the renderers to it instead); this rail's copy would have
//     been a dead-on-arrival DUPLICATE for the 'field'-variant types that
//     never showed it correctly in the first place.
//   - buttonBackground/buttonText: DIE — frame/theme-owned per contract
//     §8.5b; renderContinueButton/renderAutoAdvanceButton/answerGroupRootStyle
//     keep reading a LEGACY stored value untouched (§12 no-regression), but
//     no NEW authoring control exists for them.
//   - iconColor: SURVIVES, re-gated to its real consumer (renderCardGrid) —
//     was "gated for exactly one type, dead elsewhere" (S2-7); now hidden
//     everywhere EXCEPT the two card grids (overrideRowHidden below).
//   - rangeColor: SURVIVES — renderRange DOES consume it (the fill color);
//     re-gated to the range family only.
//   - columns/gridGap: unchanged (already correctly gated to the card grids).
//   - imageFit: RELOCATED to the Content tab, next to the choices editor
//     (deliverable 4's image-controls area) — see renderImageFitControl.
function renderStyleExtraControls(design: FunnelDesign): string {
  const tokenOptions = curatedTokenOptions(design);
  const colorTyped: ReadonlySet<string> = new Set(COLOR_TYPED_OVERRIDE_KEYS);
  const roleRows = Object.keys(ROLE_CONTROL_LABELS)
    .map((key) => {
      // §9.4 (wave 2): COLOR-typed keys are role swatch rows — option VALUES
      // are the 14 §9.1 ROLE NAMES (picking writes the role, never hex), an
      // inheritance tag + source line, "Reset to inherited" once overridden,
      // and the legacy-hex "Custom color (legacy) — [Convert…]" affordance
      // (island-populated from the stored value). NO hex text renders here.
      if (!colorTyped.has(key)) return "";
      return `<div class="form-group lg-inspector-field studio-role-row" data-override-row="${escapeHtml(key)}">
  <label class="form-label" for="lg-inspector-${escapeHtml(key)}">${escapeHtml(ROLE_CONTROL_LABELS[key] ?? key)}</label>
  <div class="studio-role-line">
    <span class="studio-role-swatch" data-override-swatch="${escapeHtml(key)}" aria-hidden="true"></span>
    <select id="lg-inspector-${escapeHtml(key)}" class="form-input" data-inspector-override="${escapeHtml(key)}"><option value="">Inherited (design default)</option>${roleSelectOptions()}</select>
    <button type="button" class="btn btn-sm btn-outline" data-override-reset="${escapeHtml(key)}" hidden>Reset to inherited</button>
  </div>
  <p class="form-help studio-role-source" data-override-source="${escapeHtml(key)}"></p>
  <p class="form-help studio-role-custom" data-override-custom="${escapeHtml(key)}" hidden>Custom color &#8212; not a theme role. <button type="button" class="studio-link-btn" data-override-convert="${escapeHtml(key)}">Convert to a theme color</button></p>
</div>`;
    })
    .join("");
  const structuralRows = Object.keys(TOKEN_CONTROL_LABELS)
    .map((key) => {
      const opts = (tokenOptions[key] ?? [])
        .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(`${o.label} (${o.value})`)}</option>`)
        .join("");
      // §7.4: the no-override state reads as an inherited value ("Inherited
      // (design default)") — re-picking it IS the "Reset to inherited"
      // affordance for the structural keys. The row wrapper carries
      // data-override-row so the island can GATE dead-write rows per type
      // (columns/gridGap render only for the card grids).
      return `<div class="form-group lg-inspector-field" data-override-row="${escapeHtml(key)}">
  <label class="form-label" for="lg-inspector-${escapeHtml(key)}">${escapeHtml(TOKEN_CONTROL_LABELS[key])}</label>
  <select id="lg-inspector-${escapeHtml(key)}" class="form-input" data-inspector-override="${escapeHtml(key)}"><option value="">Inherited (design default)</option>${opts}</select>
</div>`;
    })
    .join("");
  // §6.6 (F3): the preset control is the SAVED-presets dropdown (island fills
  // it from GET /component-presets, filtered to the selected node's type) +
  // "(none)". Picking a preset MERGES its overrides/props onto the node and
  // stores the NAME as provenance (`design_preset`); "(none)" clears the
  // provenance only. The free-text input is GONE.
  return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="lg-inspector-preset">Component style preset</label>
  <select id="lg-inspector-preset" class="form-input" data-preset-select><option value="">(none)</option></select>
  <p class="form-help">Saved presets for this component type. Applying merges the preset&#8217;s design/layout values onto this component.</p>
</div>
${roleRows}
${structuralRows}`;
}

// v3.1 R3b deliverable 2 (imageFit relocation): the SAME control the old rail
// carried, moved to the Content tab next to the choices editor (deliverable
// 4's image-controls neighborhood) — still gated to ImageCardAnswerGrid only
// (its one real consumer, renderCardGrid's per-node image_fit read), still
// writing props.image_fit through the standard data-inspector-field path.
function renderImageFitControl(): string {
  return `<div class="form-group lg-inspector-field" data-image-fit-wrap hidden>
  <label class="form-label" for="lg-inspector-image-fit">Image fit (how card photos fill their box)</label>
  <select id="lg-inspector-image-fit" class="form-input" data-inspector-field="image_fit">
    <option value="">Default (browser fit)</option>
    <option value="cover">Cover — fill the card, may crop</option>
    <option value="contain">Contain — show the whole image</option>
  </select>
</div>`;
}

// §8.5 container prop controls — dropdowns of the EXACT enum values
// content-schema validates (imported constants, never retyped).
interface ContainerControl {
  key: string;
  label: string;
  kind: "enum" | "int" | "bool" | "text" | "lines";
  values?: readonly (string | number)[];
}

const CONTAINER_PROP_CONTROLS: ReadonlyArray<{ type: string; controls: readonly ContainerControl[] }> = [
  {
    type: "Stack",
    controls: [
      { key: "direction", label: "Direction", kind: "enum", values: LEADGEN_STACK_DIRECTIONS },
      { key: "gap", label: "Gap token", kind: "enum", values: LEADGEN_GAP_TOKENS },
      { key: "align", label: "Align", kind: "enum", values: LEADGEN_STACK_ALIGNS },
    ],
  },
  {
    type: "GridContainer",
    controls: [
      { key: "columnsDesktop", label: "Columns (desktop)", kind: "int", values: [2, 3, 4, 5] },
      { key: "columnsTablet", label: "Columns (tablet)", kind: "int", values: [1, 2, 3, 4] },
      { key: "columnsMobile", label: "Columns (mobile)", kind: "int", values: [1, 2] },
      { key: "gap", label: "Gap token", kind: "enum", values: LEADGEN_GAP_TOKENS },
      { key: "sizing", label: "Card sizing", kind: "enum", values: LEADGEN_GRID_SIZINGS },
    ],
  },
  {
    type: "Columns",
    controls: [
      { key: "ratio", label: "Ratio preset", kind: "enum", values: LEADGEN_COLUMN_RATIOS },
      { key: "mobile", label: "Mobile stacking", kind: "enum", values: LEADGEN_COLUMN_MOBILE_MODES },
    ],
  },
  {
    type: "CardPanel",
    controls: [
      { key: "width", label: "Width preset", kind: "enum", values: LEADGEN_PANEL_WIDTHS },
      { key: "background", label: "Background token", kind: "enum", values: LEADGEN_PANEL_BACKGROUNDS },
      { key: "shadow", label: "Shadow token", kind: "enum", values: LEADGEN_PANEL_SHADOWS },
      { key: "radius", label: "Radius token", kind: "enum", values: LEADGEN_PANEL_RADII },
      { key: "padding", label: "Padding token", kind: "enum", values: LEADGEN_PANEL_PADDINGS },
    ],
  },
  {
    type: "BackgroundPanel",
    controls: [
      { key: "background", label: "Background token", kind: "enum", values: LEADGEN_BG_PANEL_BACKGROUNDS },
      { key: "gradient", label: "Gradient token", kind: "enum", values: LEADGEN_BG_PANEL_GRADIENTS },
      { key: "imageMediaId", label: "Image media id", kind: "text" },
    ],
  },
  {
    type: "Spacer",
    controls: [
      { key: "size", label: "Size token", kind: "enum", values: LEADGEN_GAP_TOKENS },
      // v3.1 R3b E2-NEW-9 (main): renderSpacer has ALWAYS rendered the "line"
      // variant correctly (a horizontal divider) — only authoring it was
      // missing. Gap is the default (absent/unknown value renders the plain
      // spacer, unchanged).
      { key: "variant", label: "Style", kind: "enum", values: LEADGEN_SPACER_VARIANTS },
    ],
  },
  {
    type: "HeaderBar",
    controls: [
      { key: "logoMediaId", label: "Logo media id", kind: "text" },
      { key: "logoAlt", label: "Logo alt text", kind: "text" },
      { key: "back", label: "Show Back", kind: "bool" },
      { key: "backLabel", label: "Back label", kind: "text" },
      { key: "secure", label: "Show secure badge", kind: "bool" },
      { key: "secureText", label: "Secure copy", kind: "text" },
    ],
  },
  {
    type: "FooterBar",
    controls: [
      { key: "legalHtml", label: "Legal copy", kind: "text" },
      { key: "trustMessages", label: "Trust messages (one per line)", kind: "lines" },
      { key: "links", label: "Links (label|href per line)", kind: "lines" },
    ],
  },
  // §8.5/§8.6 structured-prop AFFORDANCE/CHROME leaves: the catalog lists
  // these props as authorable; the controls ride the same
  // data-container-prop collect path as the layout groups above.
  {
    type: "TrustBar",
    controls: [
      // renderTrustBar reads props.items [{icon,text}] — the FooterBar links
      // "label|href" line idiom, here "icon|text" (icon optional).
      { key: "items", label: "Items (icon|text per line)", kind: "lines" },
      // renderTrustBar: layout === "stacked" stacks; anything else horizontal.
      { key: "layout", label: "Layout", kind: "enum", values: ["horizontal", "stacked"] },
    ],
  },
  {
    type: "LogoStrip",
    controls: [
      // renderLogoStrip reads props.logos [{mediaId,alt}] — "mediaId|alt".
      { key: "logos", label: "Logos (mediaId|alt per line)", kind: "lines" },
    ],
  },
  {
    type: "StepIndicator",
    controls: [
      // renderStepIndicator reads numeric props.steps/current (>=1; current
      // clamped to steps — the island collect mirrors the preset's clamp).
      { key: "steps", label: "Steps (total, ≥1)", kind: "int" },
      { key: "current", label: "Current step (1…steps)", kind: "int" },
    ],
  },
];

// Types whose structured props get an inspector Layout-tab group (the §8.5
// containers/leaves above + the structured-prop affordance/chrome leaves).
// The island shows the Layout tab for any type in this set.
const STRUCTURED_PROP_TYPES: ReadonlySet<string> = new Set(
  CONTAINER_PROP_CONTROLS.map((group) => group.type),
);

function renderContainerControl(type: string, control: ContainerControl): string {
  const id = `lg-container-${type}-${control.key}`;
  if (control.kind === "bool") {
    return `<div class="form-group lg-inspector-field"><label class="lg-check"><input type="checkbox" id="${escapeHtml(id)}" data-container-prop="${escapeHtml(control.key)}" /> ${escapeHtml(control.label)}</label></div>`;
  }
  if (control.kind === "enum" || (control.kind === "int" && control.values !== undefined)) {
    return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="${escapeHtml(id)}">${escapeHtml(control.label)}</label>
  <select id="${escapeHtml(id)}" class="form-input" data-container-prop="${escapeHtml(control.key)}" data-container-kind="${control.kind}"><option value="">default</option>${options(control.values ?? [])}</select>
</div>`;
  }
  if (control.kind === "int") {
    // Open-ended numeric prop (StepIndicator steps/current): a real number
    // input, ≥1 — the island collect clamps and keeps current ≤ steps.
    return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="${escapeHtml(id)}">${escapeHtml(control.label)}</label>
  <input id="${escapeHtml(id)}" class="form-input" type="number" min="1" step="1" data-container-prop="${escapeHtml(control.key)}" data-container-kind="int" />
</div>`;
  }
  if (control.kind === "lines") {
    return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="${escapeHtml(id)}">${escapeHtml(control.label)}</label>
  <textarea id="${escapeHtml(id)}" class="form-input" rows="3" data-container-prop="${escapeHtml(control.key)}" data-container-kind="lines"></textarea>
</div>`;
  }
  return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="${escapeHtml(id)}">${escapeHtml(control.label)}</label>
  <input id="${escapeHtml(id)}" class="form-input" type="text" data-container-prop="${escapeHtml(control.key)}" data-container-kind="text" />
</div>`;
}

// v3.1 R3b (renamed from renderLayoutPanel — S2-7/S4-A4 rail removal; see the
// golden-regions note on renderStyleExtraControls above). The container prop
// controls THEMSELVES are unchanged, real, and consumed — only the jargon
// "§8.5 tokenized layout props" preamble that used to sit above this output
// is gone (deliverable 2: "a clean, jargon-free Layout section... for
// container types only").
function renderContainerLayoutPanel(): string {
  const groups = CONTAINER_PROP_CONTROLS.map((group) => {
    const controls = group.controls.map((ctl) => renderContainerControl(group.type, ctl)).join("");
    const cta =
      group.type === "HeaderBar"
        ? `<div class="form-group lg-inspector-field">
  <label class="form-label">Call CTA (label + tel/href)</label>
  <input class="form-input" type="text" data-container-cta="label" placeholder="CTA label" />
  <input class="form-input" type="text" data-container-cta="tel" placeholder="tel: number" />
  <input class="form-input" type="text" data-container-cta="href" placeholder="or https:// link" />
</div>`
        : "";
    return `<div class="studio-container-group" data-container-group="${escapeHtml(group.type)}" hidden>${controls}${cta}</div>`;
  }).join("");
  return groups;
}

// §7.1 scope header — ALWAYS visible, the inspector's FIRST element (replaces
// the static "Select a component" head). Operator words only (labels, never
// type ids); the pills are the §7.2 scope switcher (Funnel frame is disabled
// here — the frame is Quote-Builder-owned); the Affects line is the honest
// blast-radius sentence (Section scope cites the live "Used in N quotes"
// count from GET /sections/:id/usage). A scope change re-renders this region
// and announces via aria-live (§7.2).
function renderScopeHeaderShell(): string {
  return `<div class="studio-scope-header" data-studio-scope-header aria-live="polite">
  <p class="studio-scope-editing">Editing: <strong data-scope-editing-name>This Section (question unit)</strong></p>
  <p class="studio-muted-note" data-scope-what-it-is hidden></p>
  ${renderScopePillsMarkup()}
  <div class="studio-scope-affects" data-studio-affects-callout>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.9 6.3 6.9.7-5.1 4.6 1.4 6.8L12 17.8 5 20.2l1.4-6.8L1.3 8.9l6.9-.7z" fill="${STUDIO_COLOR.accent}"/></svg>
    <span class="studio-scope-affects-text" data-scope-affects>Affects: changes apply everywhere this Section is used.</span>
  </div>
</div>`;
}

// MINOR-3 (adversarial review, 2026-07-15): extracted OUT of
// renderStudioInspector into its OWN top-level block — golden-allowlist.json
// classifies this ONE function golden:false (U15 clarity erratum: the golden
// mockup's Appendix-A copy reads "Inherited from the frame" / "Change in
// frame ->"; this block ships the operator-clarity rename "From the funnel
// layout" / "Edit in Quote Builder ->" instead), restoring
// renderStudioInspector itself to golden:true (the tab SYSTEM it assembles is
// still golden-verbatim; only this one panel's copy diverges).
//
// v3.1 R3b S2-2 (reclassified, contract §8.5b: the funnel layout owns look/
// position — no editable pickers here by design). Each row shows the REAL
// resolved value (island-populated) instead of a hardcoded string, plus a
// working deep link into the Quote Builder that actually owns the setting.
function renderStyleContinueBlock(): string {
  return `<div data-style-continue-block hidden>
      <div class="studio-panel-eyebrow">From the funnel layout</div>
      <div class="studio-inherited-row"><span>Color</span><span><span data-continue-color-text>Button</span> <span class="studio-inherited-tag">inherited</span></span></div>
      <button type="button" class="studio-link-btn" data-continue-change-in-frame="color">Edit in Quote Builder &#8594;</button>
      <div class="studio-inherited-row"><span>Position</span><span><span data-continue-position-text>Inside the question &#183; default &#8212; set per funnel in the Quote Builder</span> <span class="studio-inherited-tag">inherited</span></span></div>
      <button type="button" class="studio-link-btn" data-continue-change-in-frame="position">Edit in Quote Builder &#8594;</button>
      <div class="studio-inherited-row"><span>Size</span><span>Medium (fixed) <span class="studio-inherited-tag">inherited</span></span></div>
      <button type="button" class="studio-link-btn" data-continue-change-in-frame="size">Edit in Quote Builder &#8594;</button>
    </div>`;
}

// The full tabbed inspector. Panels are server-rendered ONCE; the island
// toggles tab/panel visibility per the selected node's type metadata and
// populates/collects values (data-inspector-field / data-inspector-override /
// data-inspector-cond / data-choice-field / data-container-prop hooks).
// §7.3: the tab STRIP is dynamic per selection (availableTabsFor island-side)
// — never a fixed strip; §7.4 relabeling keeps every visible string in
// operator words.
export function renderStudioInspector(design: FunnelDesign, sectionPublicId: string | null): string {
  // v3.1 §10.2 fix round (M1 — adversarial review): the Style tab's "Manage
  // theme →" link must carry ?from=<section public_id> so the Themes
  // manager's "← Back to section" can return here instead of degrading to
  // the sections list (ui-theme-manager.ts's OWN documented fallback for a
  // bare, param-less landing). A brand-new (unsaved) Section has no
  // public_id yet — the link stays bare, matching that same fallback.
  const manageThemeHref =
    sectionPublicId !== null ? `/admin/leadgen/themes?from=${encodeURIComponent(sectionPublicId)}` : "/admin/leadgen/themes";
  const opOptions = options(
    CONDITION_OP_OPTIONS,
    CONDITION_OP_OPTIONS.map((c) => CONDITION_OP_LABELS[c] ?? c),
  );
  const patternOptions = options(PATTERN_PRESETS);
  // The generic per-type copy fields (CONTENT_PROP_FIELDS projection) — still
  // used by many non-field types (ContinueButton/TextBlock/containers/etc);
  // the 8 Accept-swappable text-input types get their OWN dedicated "Field
  // label"/"Leading icon" controls below (§8.3 Basics — see the
  // CONTENT_PROP_FIELDS comment: the shared "Label" text is wrong for them).
  const contentInputs = CONTENT_CONTROLS.map(
    (ctl) => `<div class="form-group lg-inspector-field" data-content-prop="${escapeHtml(ctl.key)}" hidden>
  <label class="form-label" for="lg-content-${escapeHtml(ctl.key)}">${escapeHtml(ctl.label)}</label>
  <input id="lg-content-${escapeHtml(ctl.key)}" class="form-input" type="text" data-inspector-field="${escapeHtml(ctl.key)}" />
</div>`,
  ).join("");

  // v3.1 §8.2 — the golden's 5 DYNAMIC tabs (never a fixed strip); "Advanced"
  // is a separate persistent disclosure BELOW the tab body (golden 606-618),
  // not a 6th tab. Rules/Maps/Offers are hidden per-selection by
  // availableTabsFor (populateInspector, island-side); Content/Style always
  // show '' server-side default state renders all 5 unhidden — the island's
  // initial populateInspector call (on load) corrects visibility before the
  // first user-visible paint, exactly like the pre-v3.1 9-tab strip did.
  const tabs: ReadonlyArray<{ key: string; label: string }> = [
    { key: "content", label: "Content" },
    { key: "style", label: "Style" },
    { key: "rules", label: "Rules" },
    { key: "maps", label: "Maps" },
    { key: "offers", label: "Offers" },
  ];
  const tabButtons = tabs
    .map(
      (t, i) =>
        `<button type="button" class="studio-tab${i === 0 ? " active" : ""}" role="tab" data-studio-inspector-tab="${t.key}" aria-selected="${i === 0 ? "true" : "false"}">${escapeHtml(t.label)}</button>`,
    )
    .join("");

  return `<aside class="studio-inspector" id="lg-studio-inspector" data-studio-inspector aria-label="Component inspector">
  ${renderScopeHeaderShell()}
  <p class="form-help studio-section-scope-note" data-studio-section-scope-note>Edit the question headline, subheadline and Continue behavior in the Question strip above. Select a component on the canvas to edit its content and design.</p>
  <div class="studio-tabs" role="tablist" aria-label="Inspector tabs">${tabButtons}</div>

  <!-- ============================================================ -->
  <!-- CONTENT tab (§8.3/§8.4): bound headline/subheadline · continue ·
       field Basics/Behavior/Answer-format/Connect-to-Offers · choices ·
       defaults. Exactly one of the four blocks below is shown per selection
       (populateInspector), matching §8.2's "Content shown for a copy-bearing
       or answer selection" rule. -->
  <div class="studio-panel" data-studio-panel="content" role="tabpanel">

    <!-- headline/subheadline (bound node selected) — §8.4 -->
    <div class="lg-inspector-field" data-content-headline-block hidden>
      <div class="studio-panel-eyebrow">The question</div>
      <label class="form-label" for="lg-bound-headline-input">Headline</label>
      <input id="lg-bound-headline-input" class="form-input" type="text" data-bound-shared-input="section_headline" />
      <label class="form-label" for="lg-bound-subheadline-input">Subheadline</label>
      <input id="lg-bound-subheadline-input" class="form-input" type="text" data-bound-shared-input="section_subheadline" />
      <p class="form-help studio-inline-note">Same text as the header box above — one source, two places to edit.</p>
      <button type="button" class="studio-danger-link" data-bound-hide>Hide in this question</button>
      <p class="form-help">The text is kept — you can show it again anytime.</p>
    </div>

    <!-- continue (§8.4) -->
    <div class="lg-inspector-field" data-content-continue-block hidden>
      <p class="alert studio-callout-blue">The button&#8217;s look &amp; position are set once for the whole funnel. <button type="button" class="studio-link-btn" data-open-quote-builder>Open Quote Builder &#8594;</button></p>
      <label class="form-label" for="lg-continue-label-input">Button label</label>
      <input id="lg-continue-label-input" class="form-input" type="text" data-inspector-field="label" />
    </div>

    <!-- v3.1 R3b deliverable 8 (E2-NEW-3/E2-NEW-8/E2-C4): the 10 frame-scope
         types (HeaderBar/FooterBar/TrustBar/LogoStrip/StepIndicator/
         ProgressBar/HeaderLogo/BackButton/DisclosureLink/BackgroundPanel) —
         frame.ts synthesizes its OWN chrome for these concerns; an in-Section
         instance's props are production-inert. A read-only notice REPLACES
         editing controls (Content AND Style — see data-style-framescope-
         block) instead of showing dead-write controls; canvas render of the
         legacy node itself is UNCHANGED (this notice only touches the
         inspector). DisclosureLink's save-repair (deliverable 5b) still runs
         regardless of this notice; LogoStrip is ALSO a retired type — the
         deliverable-7 migration converts it to ImageBlock ON SAVE, so this
         notice is a PRE-SAVE-only view for it. -->
    <div class="lg-inspector-field" data-content-framescope-block hidden>
      <p class="alert studio-callout-blue" data-framescope-note>Part of the funnel layout — shared by every section in this funnel. Edit it in the Quote Builder.<button type="button" class="studio-link-btn" data-framescope-change-in-frame>Edit in Quote Builder &#8594;</button></p>
    </div>

    <!-- field: Basics/Behavior/Answer-format/Connect-to-Offers (§8.3) -->
    <div data-content-field-block hidden>
      <!-- v3.1 R3b deliverable 4 (E2-NEW-1): ImageBlock's completed controls —
           source toggle (Image from library / Site logo), alt text (media
           source only), and a REAL media picker + live thumbnail (the same
           choice-cell mechanism deliverable 6d of R3a built, applied to this
           single node-level field). Gated to node.type==='ImageBlock' only. -->
      <div data-content-imageblock-block hidden>
        <div class="studio-panel-eyebrow">Image</div>
        <label class="form-label">Source</label>
        <div class="studio-segmented" role="group" aria-label="Image source" data-imageblock-source-group>
          <button type="button" data-set-imageblock-source="media">Image from library</button>
          <button type="button" data-set-imageblock-source="auto_logo">Site logo</button>
        </div>
        <div data-imageblock-media-fields hidden>
          <label class="form-label" for="lg-imageblock-media">Image</label>
          <div class="lg-choice-image-row">
            <img class="lg-choice-thumb" data-imageblock-thumb alt="" hidden>
            <input id="lg-imageblock-media" class="form-input" type="text" data-inspector-field="logoMediaId" placeholder="Image URL" />
            <button type="button" class="btn btn-sm btn-outline" data-imageblock-media-choose>Choose&#8230;</button>
          </div>
          <label class="form-label" for="lg-imageblock-alt">Alt text</label>
          <input id="lg-imageblock-alt" class="form-input" type="text" data-inspector-field="alt" placeholder="Describe the image for screen readers" />
        </div>
        <p class="form-help" data-imageblock-autologo-note hidden>Renders your site&#8217;s logo automatically. The Section Studio preview shows a placeholder — the live funnel fills in the real logo.</p>
      </div>
      <div class="studio-panel-eyebrow">Basics</div>
      <div class="lg-inspector-field" data-field-label-wrap hidden>
        <label class="form-label" for="lg-field-label">Field label <span class="studio-muted-note">&#183; only you see this</span></label>
        <input id="lg-field-label" class="form-input" type="text" data-inspector-field="label" />
      </div>
      ${contentInputs}
      <div class="lg-inspector-field" data-leading-icon-wrap hidden>
        <label class="form-label" for="lg-leading-icon">Leading icon</label>
        <select id="lg-leading-icon" class="form-input" data-inspector-field="icon"><option value="">&#8212; none &#8212;</option>${LEADING_ICON_OPTION_HTML}</select>
      </div>

      <!-- R5 D3 (register S4-A3 migration): the 5-type copy-node TYPE SWAP
           (Headline/Subheadline/Kicker/Helper/Legal), migrated here from the
           canvas toolbar's old "text" cluster. Gated to isCopyNode(node)
           (island). Named "Type" (not "Role" — TextBlock's OWN role picker
           lives in the Style tab, a different axis, TEXT_BLOCK_ROLE_OPTION_HTML). -->
      <div class="lg-inspector-field" data-content-typeswap-wrap hidden>
        <label class="form-label" for="lg-content-type-swap">Type</label>
        <select id="lg-content-type-swap" class="form-input" data-text-role aria-label="Type" title="Type — swaps the concrete stored type">${COPY_NODE_TYPE_SWAP_OPTION_HTML}</select>
      </div>

      <!-- v3.1 R3b E1-C8: Behavior (Required/When-answered) only makes sense
           for an ANSWER-PRODUCING selection — gated to meta.produces!==null
           (island-side) so it never shows for TextBlock/CategoryLabel/
           HelperText/LegalNote or AutoAdvanceButton (produces:null; the
           register's own "nonsense controls" example). -->
      <div data-content-behavior-section hidden>
      <div class="studio-hr"></div>
      <div class="studio-panel-eyebrow">Behavior</div>
      <div class="studio-row-between">
        <span class="lg-check-label">Required</span>
        <label class="lg-check"><input type="checkbox" data-inspector-field="required" aria-label="Required" /></label>
      </div>
      <p class="form-help">Visitors must answer before they can continue.</p>
      <div class="form-label">When answered</div>
      <div class="studio-segmented" role="group" aria-label="When answered" data-continue-mode-group>
        <button type="button" data-set-continue-mode="button">Wait for Continue</button>
        <button type="button" data-set-continue-mode="auto_advance">Go to next</button>
      </div>
      </div><!-- /data-content-behavior-section -->

      <div class="studio-hr"></div>
      <div class="studio-panel-eyebrow">Answer format</div>
      <div class="lg-inspector-field" data-accept-wrap hidden>
        <label class="form-label" for="lg-inspector-accept">Accept</label>
        <select id="lg-inspector-accept" class="form-input" data-inspector-accept>${ACCEPT_OPTION_HTML}</select>
      </div>
      <!-- R5 D3 (register S4-A3 migration): searchable-dropdown / card-style /
           slider-format toggles — MIGRATED from the canvas toolbar's
           "component" cluster (each SWITCHES the concrete stored component
           type, the same category as Accept above). Attribute names kept
           verbatim (data-toolbar-searchable(-wrap)/data-card-style/
           data-toolbar-slider-format(-wrap)) — their JS wiring is
           attribute-addressed, unaffected by this relocation. -->
      <div class="lg-inspector-field" data-toolbar-searchable-wrap hidden>
        <button type="button" class="btn btn-sm btn-outline" data-toolbar-searchable aria-pressed="false" title="Searchable dropdown — switches the component type">Searchable: off</button>
      </div>
      <div class="lg-inspector-field" data-toolbar-card-style-wrap hidden>
        <label class="form-label">Card style</label>
        <div class="studio-segmented" role="group" aria-label="Card style">
          <button type="button" data-card-style="icon">Icon</button>
          <button type="button" data-card-style="image">Image</button>
          <button type="button" data-card-style="plain">Plain</button>
        </div>
      </div>
      <div class="lg-inspector-field" data-toolbar-slider-format-wrap hidden>
        <button type="button" class="btn btn-sm btn-outline" data-toolbar-slider-format aria-pressed="false" title="Amount ($) format — switches the component type">Format $: off</button>
      </div>
      <div class="form-group lg-inspector-field" data-vprop="min" hidden>
        <label class="form-label" for="lg-vprop-min">Min</label>
        <input id="lg-vprop-min" class="form-input" data-inspector-vprop="min" />
      </div>
      <div class="form-group lg-inspector-field" data-vprop="max" hidden>
        <label class="form-label" for="lg-vprop-max">Max</label>
        <input id="lg-vprop-max" class="form-input" data-inspector-vprop="max" />
      </div>
      <div class="form-group lg-inspector-field" data-vprop="step" hidden>
        <label class="form-label" for="lg-vprop-step">Step</label>
        <input id="lg-vprop-step" class="form-input" data-inspector-vprop="step" />
      </div>
      <div class="form-group lg-inspector-field" data-vprop="maxLen" hidden>
        <label class="form-label" for="lg-vprop-maxLen">Max length</label>
        <input id="lg-vprop-maxLen" class="form-input" data-inspector-vprop="maxLen" />
      </div>
      <div class="form-group lg-inspector-field" data-vprop="pattern" hidden>
        <label class="form-label" for="lg-vprop-pattern">Pattern preset</label>
        <select id="lg-vprop-pattern" class="form-input" data-inspector-vprop="pattern_preset">${patternOptions}</select>
        <input class="form-input" type="text" data-inspector-vprop="pattern" placeholder="custom regex (custom preset only)" hidden />
      </div>
      <div class="form-group lg-inspector-field" data-vprop-error-wrap hidden>
        <label class="form-label" for="lg-vprop-error">If it&#8217;s wrong, say</label>
        <input id="lg-vprop-error" class="form-input" type="text" data-inspector-vprop="error_text" />
      </div>
      <p class="form-help" data-range-format-note hidden>Provider output format is set per Offer in the Offers tab (value transform) &#8212; sliders store the plain number here.</p>

      <div class="studio-hr"></div>
      <div class="lg-inspector-field studio-connect-offers-card" data-connect-offers-card hidden>
        <p data-connect-offers-text></p>
        <button type="button" class="studio-link-btn" data-connect-offers-review>Review mapping &#8594;</button>
      </div>

      <div data-field-choices-block hidden>
        <!-- v3.1 R3b E1-C5 (catalog hygiene): discoverability hint for the
             3-type card-style family (Icon/Image/Plain share ONE toolbar
             switch, not 3 separate insert paths). -->
        <p class="form-help" data-card-style-hint hidden>Card style: Icon &#183; Image &#183; Plain &#8212; switch above, in Answer format.</p>
        ${renderImageFitControl()}
        <div class="lg-choice-list" data-inspector-choices></div>
        <button type="button" class="btn btn-sm btn-secondary" id="lg-choice-add">+ Add choice</button>
        <div class="form-group lg-inspector-field studio-othergroup">
          <label class="lg-check"><input type="checkbox" data-choicedisplay="otherGroupEnabled" /> Enable &quot;Other&quot; group</label>
          <input class="form-input" type="text" data-choicedisplay="otherGroupLabel" placeholder="Other-group label (default: Other)" />
          <label class="lg-check"><input type="checkbox" data-choicedisplay="searchableOther" /> Searchable Other panel</label>
        </div>
        <div class="form-group lg-inspector-field">
          <label class="form-label" for="lg-choice-bulk">Bulk paste (one per line: label = value)</label>
          <textarea id="lg-choice-bulk" class="form-input" rows="3" data-choice-bulk placeholder="Toyota = toyota&#10;Honda = honda"></textarea>
          <button type="button" class="btn btn-sm btn-secondary" id="lg-choice-bulk-apply">Apply bulk paste</button>
        </div>
        <p class="form-help" data-choices-c1-note>Answer choices own display and normalization only. Provider values are set per Offer in the Offers tab &#8212; each row&#8217;s chip shows them read-only.</p>
      </div>

      <div class="form-group lg-inspector-field" data-default-wrap="yesno" hidden>
        <label class="form-label" for="lg-default-yesno">Default answer</label>
        <select id="lg-default-yesno" class="form-input" data-default-control="yesno">
          <option value="">No default — the visitor picks</option>
          <option value="true">Yes (pre-selected)</option>
          <option value="false">No (pre-selected)</option>
        </select>
        <p class="form-help">A default pre-selects the answer — the visitor must still confirm it before continuing.</p>
      </div>
      <div class="form-group lg-inspector-field" data-default-wrap="range" hidden>
        <label class="form-label" for="lg-default-range">Default value</label>
        <input id="lg-default-range" class="form-input" type="number" data-default-control="range" placeholder="Starts at the minimum when empty" />
        <p class="form-help">Where the slider starts. Leave empty to start at the minimum.</p>
      </div>
      <div class="form-group lg-inspector-field" data-default-wrap="dropdown" hidden>
        <label class="form-label" for="lg-default-dropdown">Default choice</label>
        <select id="lg-default-dropdown" class="form-input" data-default-control="dropdown"><option value="">No default — the visitor picks</option></select>
        <p class="form-help">Pre-selects one of this component&#8217;s choices.</p>
      </div>
    </div>

    <p class="form-help" data-content-empty hidden>This component has no editable copy — see the Style / Advanced disclosures.</p>
  </div>

  <!-- ============================================================ -->
  <!-- STYLE tab (§8.5/§8.5b): field Width/Height/Corners/Border-color ·
       Text/bound-headline Role/Text-color · Continue read-only inherited. -->
  <div class="studio-panel" data-studio-panel="style" role="tabpanel" hidden>

    <!-- v3.1 R3b deliverable 8: the SAME read-only frame-scope notice as the
         Content tab (data-content-framescope-block) — no Width/Corners/Layout
         controls render for these 10 types either. -->
    <div class="lg-inspector-field" data-style-framescope-block hidden>
      <p class="alert studio-callout-blue">Part of the funnel layout — shared by every section in this funnel. Edit it in the Quote Builder.<button type="button" class="studio-link-btn" data-framescope-change-in-frame>Edit in Quote Builder &#8594;</button></p>
    </div>

    <div data-style-field-block hidden>
      <!-- R5 D3 (register S4-A3 migration, §6.6 named presets): MIGRATED from
           the canvas toolbar's "preset" cluster — applying/saving a style
           preset IS a Style-tab concern (it captures curated overrides +
           layout props). data-preset-apply/data-preset-save keep their exact
           attribute names — both already bind directly (presetApplyEl /
           presetSaveEl), unaffected by this relocation. -->
      <div data-preset-row hidden style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <select id="lg-style-preset-apply" class="form-input" data-preset-apply aria-label="Apply preset"><option value="">Apply preset&#8230;</option></select>
        <button type="button" class="btn btn-sm btn-outline" data-preset-save>Save as preset&#8230;</button>
      </div>
      <!-- v3.1 R3 (register S2-1/E1-C3/E2-NEW-7): the Width/Height/Corners/Border
           quad renders ONLY for a type whose renderer CONSUMES those overrides
           (isSizeConsumingType — the 8 text-input family + the 8 R3 choice/
           dropdown types); hidden for every other 'field'-variant type
           (containers, Range family, NameFieldsGroup) so no control is shown
           that the renderer would ignore. -->
      <div data-style-size-appearance hidden>
      <div class="studio-panel-eyebrow-row"><span class="studio-panel-eyebrow">Size &amp; width</span><span class="studio-muted-note" data-style-theme-note>from theme: Navy</span></div>
      <label class="form-label">Width</label>
      <div class="studio-segmented" role="group" aria-label="Width" data-width-preset-group>
        <button type="button" data-set-width="s">S</button>
        <button type="button" data-set-width="m">M</button>
        <button type="button" data-set-width="l">L</button>
        <button type="button" data-set-width="full">Full</button>
      </div>
      <div class="studio-custom-chip" data-width-custom-chip hidden>
        <div><span class="studio-custom-chip-label" data-width-custom-label>Custom</span><div class="studio-custom-chip-sub">Set by dragging on the canvas — overrides the preset</div></div>
        <button type="button" class="studio-link-btn" data-reset-width>Reset</button>
      </div>
      <label class="form-label">Height</label>
      <div class="studio-segmented" role="group" aria-label="Height" data-height-preset-group>
        <button type="button" data-set-height="small">Small</button>
        <button type="button" data-set-height="medium">Medium</button>
        <button type="button" data-set-height="large">Large</button>
      </div>
      <div class="studio-custom-chip" data-height-custom-chip hidden>
        <div><span class="studio-custom-chip-label" data-height-custom-label>Custom</span><div class="studio-custom-chip-sub">Set by dragging on the canvas — overrides the preset</div></div>
        <button type="button" class="studio-link-btn" data-reset-height>Reset</button>
      </div>
      <p class="form-help studio-inline-note">Presets keep every question in the funnel consistent. Drag a handle on the canvas for a one-off size — it becomes <b>Custom</b> and overrides the preset here.</p>

      <div class="studio-panel-eyebrow">Appearance</div>
      <label class="form-label">Corners</label>
      <div class="studio-segmented" role="group" aria-label="Corners" data-corners-group>
        <button type="button" data-set-corners="sharp">Sharp</button>
        <button type="button" data-set-corners="rounded">Rounded</button>
        <button type="button" data-set-corners="pill">Pill</button>
      </div>
      <label class="form-label">Border color</label>
      <div class="studio-swatch-row" role="group" aria-label="Border color" data-border-color-group>
        <button type="button" data-set-border-color="neutral"><span class="studio-role-swatch" data-border-swatch="neutral"></span>Neutral</button>
        <button type="button" data-set-border-color="brand"><span class="studio-role-swatch" data-border-swatch="brand"></span>Brand</button>
        <button type="button" data-set-border-color="accent"><span class="studio-role-swatch" data-border-swatch="accent"></span>Accent</button>
      </div>
      <p class="form-help studio-inline-note">Colors are theme roles, not fixed shades — change the theme once and every question updates. <a href="${manageThemeHref}" data-open-manage-theme>Manage theme &#8594;</a></p>
      </div><!-- /data-style-size-appearance -->

      <!-- R5 D3 (register S4-A3 migration): "Selected-state style" (button
           background / icon color role for the selected choice/card state)
           and "Card layout" (columns/gap) — MIGRATED from the canvas
           toolbar's "component"/"layout" clusters. Both gated to the choice/
           card-grid families only (populateStyleVariant), exactly the same
           condition the toolbar used. -->
      <div data-style-choice-extras hidden>
        <div class="studio-hr"></div>
        <div class="studio-panel-eyebrow">Selected-state style</div>
        <div class="lg-inspector-field" data-tb-selected-role="button" hidden>
          <label class="form-label" for="lg-style-selected-button">Button background</label>
          <select id="lg-style-selected-button" class="form-input" data-inspector-override="buttonBackground" aria-label="Selected-state style role (button background)"><option value="">Inherited</option>${roleSelectOptions()}</select>
        </div>
        <div class="lg-inspector-field" data-tb-selected-role="icon" hidden>
          <label class="form-label" for="lg-style-selected-icon">Icon color</label>
          <select id="lg-style-selected-icon" class="form-input" data-inspector-override="iconColor" aria-label="Selected-state style role (icon color)"><option value="">Inherited</option>${roleSelectOptions()}</select>
        </div>
        <div class="lg-inspector-field" data-toolbar-choice-layout hidden>
          <label class="form-label">Card layout</label>
          <div style="display:flex;gap:8px">
            <select id="lg-style-choice-columns" class="form-input" data-inspector-override="columns" aria-label="Card columns"><option value="">Columns: inherit</option>${options([2, 3, 4, 5])}</select>
            <select id="lg-style-choice-gap" class="form-input" data-inspector-override="gridGap" aria-label="Answer-grid gap token"><option value="">Gap: inherit</option>${(curatedTokenOptions(design)["gridGap"] ?? []).map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("")}</select>
          </div>
        </div>
      </div>

      <div class="studio-hr"></div>
      <div class="studio-panel-eyebrow">Layout</div>
      ${renderContainerLayoutPanel()}
      <div class="studio-hr"></div>
      ${renderStyleExtraControls(design)}
    </div>

    <div data-style-text-block hidden>
      <div class="lg-inspector-field" data-text-role-wrap hidden>
        <label class="form-label" for="lg-text-block-role">Role</label>
        <select id="lg-text-block-role" class="form-input" data-text-block-role>${TEXT_BLOCK_ROLE_OPTION_HTML}</select>
      </div>
      <div class="lg-inspector-field">
        <label class="form-label" for="lg-text-color-role">Text color role</label>
        <select id="lg-text-color-role" class="form-input" data-inspector-override="featureColor"><option value="">Inherited</option>${roleSelectOptions()}</select>
      </div>
    </div>

    ${renderStyleContinueBlock()}
  </div>

  <!-- ============================================================ -->
  <!-- RULES tab (§8.6): visual IF/THEN over the existing dependency
       evaluator — "Always show" default, sentence-rendered condition,
       "Add a condition" reveals the (existing) picker fieldset. -->
  <div class="studio-panel" data-studio-panel="rules" role="tabpanel" hidden>
    <div class="studio-panel-eyebrow">When to show this</div>
    <div class="studio-rules-always-row" data-rules-always-row>
      <span class="studio-dot-green"></span>
      <span class="lg-check-label">Always show</span>
    </div>
    <fieldset class="form-group lg-inspector-field lg-inspector-conditional" data-rules-condition-fields hidden>
      <legend class="form-label">Show this component IF</legend>
      <p class="form-help studio-cond-sentence" data-cond-sentence aria-live="polite"></p>
      <!-- R4a S3-1: no eligible source field (self-excluded, whole-section
           empty otherwise) — plain words IN PLACE of the bare dropdown. -->
      <p class="form-help" data-rules-source-empty-hint hidden>Add another question to this section to condition on it.</p>
      <select class="form-input" data-inspector-cond="when" aria-label="Depends on field"><option value="">— always visible —</option></select>
      <select class="form-input" data-inspector-cond="op" aria-label="Condition operator">${opOptions}</select>
      <select class="form-input" data-inspector-cond="value-bool" aria-label="Boolean value" hidden><option value="true">true</option><option value="false">false</option></select>
      <select class="form-input" data-inspector-cond="value-enum" aria-label="Choice value" hidden></select>
      <input class="form-input" type="text" data-inspector-cond="value" placeholder="value" aria-label="Condition value" />
      <input class="form-input" type="number" data-inspector-cond="from" placeholder="from" aria-label="Range from" hidden />
      <input class="form-input" type="number" data-inspector-cond="to" placeholder="to" aria-label="Range to" hidden />
      <input class="form-input" type="text" data-inspector-cond="values" placeholder="values, comma-separated" aria-label="Condition values" hidden />
    </fieldset>
    <button type="button" class="studio-add-condition-btn" data-rules-add-condition>+ Add a condition</button>
    <button type="button" class="studio-link-btn studio-danger-link" data-rules-remove-condition hidden>Remove condition &#8212; always show</button>

    <div class="studio-hr"></div>
    <fieldset class="form-group lg-inspector-field lg-inspector-conditional" data-reqcond-wrap hidden>
      <legend class="form-label">Require this question IF</legend>
      <p class="form-help studio-cond-sentence" data-reqcond-sentence aria-live="polite"></p>
      <!-- R4a S3-1 (same dead-end, mirrored here): no eligible source field. -->
      <p class="form-help" data-reqcond-source-empty-hint hidden>Add another question to this section to condition on it.</p>
      <select class="form-input" data-inspector-reqcond="when" aria-label="Required when field"><option value="">— only when marked Required —</option></select>
      <select class="form-input" data-inspector-reqcond="op" aria-label="Required-when operator">${opOptions}</select>
      <select class="form-input" data-inspector-reqcond="value-bool" aria-label="Required-when boolean value" hidden><option value="true">true</option><option value="false">false</option></select>
      <select class="form-input" data-inspector-reqcond="value-enum" aria-label="Required-when choice value" hidden></select>
      <input class="form-input" type="text" data-inspector-reqcond="value" placeholder="value" aria-label="Required-when value" />
      <input class="form-input" type="number" data-inspector-reqcond="from" placeholder="from" aria-label="Required-when range from" hidden />
      <input class="form-input" type="number" data-inspector-reqcond="to" placeholder="to" aria-label="Required-when range to" hidden />
      <input class="form-input" type="text" data-inspector-reqcond="values" placeholder="values, comma-separated" aria-label="Required-when values" hidden />
      <p class="form-help">An answer becomes required only while the condition holds. A component marked Required is always required.</p>
    </fieldset>
  </div>

  <!-- ============================================================ -->
  <!-- MAPS tab (§9): toggle + 3 whole-row jobs, writes props.maps
       {enabled, jobs:{validate,auction,autocomplete}} (Phase C — replaces
       the old flat autofill-oriented panel). -->
  <div class="studio-panel" data-studio-panel="maps" role="tabpanel" hidden>
    <div class="studio-panel-eyebrow">Google Maps</div>
    <div class="studio-row-between">
      <span class="lg-check-label">Validate with Google Maps</span>
      <label class="lg-check"><input type="checkbox" data-maps-enabled-toggle aria-label="Validate with Google Maps" /></label>
    </div>
    <p class="form-help">Uses this site&#8217;s Maps key. Per-field settings win over the funnel&#8217;s global toggle.</p>
    <div data-maps-jobs-block hidden>
      <p class="form-label">What should Maps do? <span class="studio-muted-note">&#183; pick at least one</span></p>
      <div class="alert alert-warning studio-maps-zero-job-banner" data-maps-zero-job-banner hidden role="status" aria-live="polite">Pick at least one job for Maps, or turn it off — otherwise it does nothing at runtime.</div>
      <label class="studio-maps-job-row"><input type="checkbox" data-maps-job="validate" /><span><span class="lg-check-label">Validate the answer</span><span class="form-help" data-maps-validate-copy></span></span></label>
      <label class="studio-maps-job-row"><input type="checkbox" data-maps-job="auction" /><span><span class="lg-check-label">Use in auction rules</span><span class="form-help">Turn the ZIP into a location the auction can target or exclude by state, city or ZIP. <a href="/admin/leadgen/auction" data-open-auction-rules>Open auction rules &#8594;</a></span></span></label>
      <p class="form-help studio-maps-degradation" data-maps-degradation-note hidden>State and city targeting need the server key — without it, only the ZIP itself is available to auction rules.</p>
      <label class="studio-maps-job-row"><input type="checkbox" data-maps-job="autocomplete" /><span><span class="lg-check-label">Auto-complete the address</span><span class="form-help">Fill this field and the other address fields in this section (city, state, street) from the ZIP.</span></span></label>
      <!-- R4b (S3-7): sibling-fill picker — shown only while autocomplete is
           on. Options are populated client-side from this Section's OTHER
           internal_field values (self excluded); writes
           props.maps.fills.<slot> = <target internal_field>. -->
      <div class="studio-maps-fills-block" data-maps-fills-block hidden>
        <p class="form-label">Also fill these fields from the resolved address</p>
        <label class="studio-maps-fill-row">Street <select class="form-input studio-maps-fill-select" data-maps-fill-slot="street" aria-label="Fill street from"></select></label>
        <label class="studio-maps-fill-row">City <select class="form-input studio-maps-fill-select" data-maps-fill-slot="city" aria-label="Fill city from"></select></label>
        <label class="studio-maps-fill-row">State <select class="form-input studio-maps-fill-select" data-maps-fill-slot="state" aria-label="Fill state from"></select></label>
        <label class="studio-maps-fill-row">ZIP <select class="form-input studio-maps-fill-select" data-maps-fill-slot="zip" aria-label="Fill ZIP from"></select></label>
      </div>
    </div>
  </div>

  <!-- ============================================================ -->
  <!-- OFFERS tab (§8.7): per-Offer destination rows (existing mapping
       mechanism, relocated + relabeled). -->
  <div class="studio-panel" data-studio-panel="offers" role="tabpanel" hidden>
    <div class="studio-panel-eyebrow">Where this answer goes</div>
    <p class="form-help">This answer is sent to each buyer in the auction. Field names differ per buyer &#8212; that&#8217;s handled here.</p>
    <div class="studio-inspector-mapping" data-studio-inspector-mapping></div>
    <button type="button" class="btn btn-sm btn-outline" data-studio-open-mapping-drawer>Open full mapping &#8594;</button>
  </div>

  <!-- ============================================================ -->
  <!-- ADVANCED (§8.8): a persistent disclosure OUTSIDE the tab system
       (golden 606-618), collapsed by default for every selection — the ONLY
       place ids/JSON/hex appear. -->
  <div class="studio-hr"></div>
  <button type="button" class="studio-advanced-toggle" data-studio-advanced-toggle aria-expanded="false">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" data-studio-advanced-chevron><path d="M8 5l8 7-8 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span>Advanced</span>
  </button>
  <div class="studio-advanced-body" data-studio-advanced-body hidden>
    <p class="form-help">For developers. Renaming these can unlink Offer mappings.</p>
    <div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-inspector-internal-field">Internal field</label>
      <input id="lg-inspector-internal-field" class="form-input studio-mono-input" type="text" data-inspector-field="internal_field" placeholder="e.g. currently_insured" />
      <!-- v3.1 R3b E2-NEW-10 (studio part): containers carry no answer field
           (server-enforced container_answer_field_forbidden, §8.5) — the
           input disables with a short human note instead of accepting a
           value that would 400 on save. -->
      <p class="form-help" data-internal-field-container-note hidden>Layout containers don&#8217;t collect an answer, so there&#8217;s no internal field to set here.</p>
      <p class="alert alert-error studio-rename-warning" data-studio-rename-warning hidden role="status" aria-live="polite"></p>
    </div>
    <div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-inspector-question-key">Analytics label</label>
      <input id="lg-inspector-question-key" class="form-input studio-mono-input" type="text" data-inspector-field="question_key" />
    </div>
    <div class="form-group lg-inspector-field">
      <span class="form-label">Component id (read-only)</span>
      <code class="studio-debug-id" data-studio-debug-id></code>
    </div>
    <div class="form-group lg-inspector-field">
      <span class="form-label">Bind marker (read-only)</span>
      <code class="studio-debug-id" data-studio-bind-marker></code>
    </div>
    <details class="studio-advanced-json">
      <summary>Raw node JSON (Advanced — the only raw JSON surface)</summary>
      <textarea id="lg-node-json" class="form-input" rows="8" data-studio-node-json aria-label="Raw component node JSON" readonly></textarea>
      <button type="button" class="btn btn-sm btn-outline" id="lg-node-json-edit" data-node-json-edit>Edit raw&#8230;</button>
      <button type="button" class="btn btn-sm btn-secondary" id="lg-node-json-apply" hidden>Apply JSON</button>
      <p class="alert alert-error" data-studio-node-json-error hidden role="alert"></p>
    </details>
  </div>
</aside>`;
}

// ---------------------------------------------------------------------------
// Bottom drawer: Offer mapping (D2 placeholder) · Validation · Preview & debug
// ---------------------------------------------------------------------------

function designPickerOptions(): string {
  const ids = [...new Set(Object.values(FUNNEL_DESIGNS).map((d) => d.id))];
  return ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("");
}

// §8.9 preview controls (Slice C wiring, moved into the drawer): viewport
// toggle + refresh + design picker + server-rendered state sims + the
// dependency sample-answers panel + the sandboxed srcdoc iframe. Element ids
// and data hooks are IDENTICAL to the old editor so the executed §9.2 island
// probes and their assertions carry over unchanged.
// R5 D4 (register S4-A5, operator decision 4): the Preview dev-console hides
// behind an explicit "QA tools" toggle (default OFF — see the drawer bar's
// data-qa-tools-toggle, renderStudioDrawer), NOT removed. Split into the
// CORE always-visible "Preview in a quote" experience (golden's own stated
// feature — pick which Quote context to preview in, Desktop/Mobile, the
// real rendered iframe) vs. the QA-ONLY debug surfaces (state simulator,
// dependency-JSON, events-would-fire log, alternate-design picker, the
// events-probe iframe) — every [data-qa-tools-only] block is SSR'd hidden
// and the island un-hides ALL of them together when the toggle is checked.
function renderPreviewPanel(): string {
  return `<div class="lg-preview-controls" data-lg-preview-controls>
  <div class="studio-frame-preview" data-studio-frame-preview role="group" aria-label="Preview with funnel layout">
    <span class="form-help">Preview with funnel layout:</span>
    <select class="form-input lg-preview-design" data-frame-pick-quote aria-label="Quote"><option value="">&#8212; no funnel layout (unit only) &#8212;</option></select>
    <select class="form-input lg-preview-design" data-frame-pick-funnel aria-label="Funnel" disabled><option value="">Funnel&#8230;</option></select>
    <select class="form-input lg-preview-design" data-frame-pick-variant aria-label="Variant" disabled><option value="">Variant&#8230;</option></select>
    <select class="form-input lg-preview-design" data-frame-pick-site aria-label="Site branding" disabled><option value="">&#8212; no site branding &#8212;</option></select>
    <p class="form-help studio-frame-empty" data-frame-preview-empty hidden>This Section isn’t used in any Quote yet — previewing in the default funnel layout.</p>
  </div>
  <div class="lg-viewport-toggle" role="group" aria-label="Preview viewport">
    <button type="button" class="btn btn-sm btn-secondary active" data-preview-viewport="desktop" aria-pressed="true">Desktop</button>
    <button type="button" class="btn btn-sm btn-secondary" data-preview-viewport="mobile" aria-pressed="false">Mobile</button>
    <!-- R4a E3-NEW-10: the overlay toggle MOVED to the canvas toolbar
         (renderCanvasToolbar) — its handler repaints the canvas, so the
         control now lives where its effect is seen, not tucked in this
         QA-console-shaped drawer tab. -->
    <button type="button" class="btn btn-sm btn-outline" id="lg-preview-refresh">Refresh preview</button>
  </div>
  <div data-qa-tools-only hidden>
    <label class="form-help" for="lg-preview-design">Design:</label>
    <select id="lg-preview-design" class="form-input lg-preview-design" data-preview-design aria-label="Preview under a funnel design">
      <option value="" selected>Default design</option>
      ${designPickerOptions()}
    </select>
    <div class="lg-states-simulator" role="group" aria-label="State simulator">
      <span class="form-help">Simulate state:</span>
      <button type="button" class="btn btn-sm btn-outline active" data-sim-state="default" aria-pressed="true">Default</button>
      <button type="button" class="btn btn-sm btn-outline" data-sim-state="selected" aria-pressed="false">Selected</button>
      <button type="button" class="btn btn-sm btn-outline" data-sim-state="error" aria-pressed="false">Error</button>
      <button type="button" class="btn btn-sm btn-outline" data-sim-state="dependency" aria-pressed="false">Dependency</button>
      <button type="button" class="btn btn-sm btn-outline" data-sim-state="validation_success" aria-pressed="false">Validation success</button>
      <button type="button" class="btn btn-sm btn-outline" data-sim-state="validation_error" aria-pressed="false">Validation error</button>
    </div>
    <div class="lg-dependency-panel" data-dependency-panel hidden>
      <label class="form-label" for="lg-dependency-answers">Sample answers (JSON, keyed by internal field) — drives the dependency/selected/error/validation sims</label>
      <textarea id="lg-dependency-answers" class="form-input" data-dependency-answers rows="3" aria-label="Sample answers for the state sims" placeholder='{ "currently_insured": true }'></textarea>
      <button type="button" class="btn btn-sm btn-secondary" id="lg-dependency-apply">Apply sample answers</button>
      <!-- R4a E3-S3: invalid JSON here previously parsed silently to {} — now
           surfaced (still behind this QA-toggle surface). -->
      <p class="alert alert-error" data-dependency-answers-error hidden role="alert"></p>
      <p class="lg-dependency-status" data-dependency-status role="status" aria-live="polite"></p>
    </div>
    <div class="studio-events" data-studio-events-panel>
      <div class="studio-events-head">
        <span class="form-label">Events that would fire</span>
        <button type="button" class="btn btn-sm btn-outline" data-studio-events-clear>Clear</button>
      </div>
      <p class="form-help" data-studio-events-note>The preview loads the REAL runtime bundle in preview mode (data-lg-preview="1"): beacons are suppressed and every would-fire event is listed here instead. Interact with the preview to see answer/continue events.</p>
      <ol class="studio-events-list" data-studio-events-list aria-live="polite"></ol>
    </div>
    <iframe id="lg-events-probe-frame" class="lg-events-probe-frame" title="Events probe (runtime preview document)" sandbox="allow-scripts" aria-hidden="true" tabindex="-1"></iframe>
  </div>
  <p id="lg-preview-error" class="alert alert-error" hidden role="alert"></p>
  <iframe id="lg-preview-frame" class="lg-preview-frame" title="Section preview" sandbox="allow-scripts"></iframe>
</div>`;
}

// §9.5 Section-level role overrides — the "Design overrides" drawer mode:
// the same swatch UI vocabulary as the Design tab (role rows over the 14
// §9.1 roles) writing the sparse {palette?, columnsDefault?, gapDefault?}
// shape into `design_overrides_json` (applied as layer 4 between theme and
// component overrides). The banner copy is §9.5-verbatim.
export const SECTION_OVERRIDES_BANNER =
  "These apply wherever this Section is used — prefer the Quote theme for funnel-wide changes.";

function renderSectionOverridesPanel(): string {
  const rows = FUNNEL_TOKEN_ROLES.map(
    (role) => `<div class="studio-role-row studio-section-role-row" data-section-role-row="${escapeHtml(role)}">
    <span class="studio-role-swatch" data-section-role-swatch="${escapeHtml(role)}" aria-hidden="true"></span>
    <label class="form-label" for="lg-section-role-${escapeHtml(role)}">${escapeHtml(STUDIO_ROLE_LABELS[role])}</label>
    <select id="lg-section-role-${escapeHtml(role)}" class="form-input" data-section-role="${escapeHtml(role)}"><option value="">Inherited</option>${roleSelectOptions()}</select>
  </div>`,
  ).join("");
  return `<div class="studio-section-overrides" data-studio-section-overrides>
  <p class="alert studio-overrides-banner" data-section-overrides-banner role="note">${escapeHtml(SECTION_OVERRIDES_BANNER)}</p>
  <div class="studio-section-roles">${rows}</div>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-section-columns-default">Default answer columns</label>
    <select id="lg-section-columns-default" class="form-input" data-section-columns-default><option value="">Inherited</option>${options([2, 3, 4, 5])}</select>
  </div>
  <div class="form-group lg-inspector-field">
    <label class="form-label" for="lg-section-gap-default">Default answer-grid gap</label>
    <select id="lg-section-gap-default" class="form-input" data-section-gap-default><option value="">Inherited</option>${options(LEADGEN_GAP_TOKENS)}</select>
  </div>
</div>`;
}

// v2.5 12 §12.1 mapping-panel COLUMN CONTRACT — the normative order. One row
// per (Offer × payload field): Offer (+ provider chip) · Provider · Placement
// (default starred) · Field (schema field LABEL; raw path in tooltip +
// Advanced) · Expected type (plain words) · Required ✓/— · Mapped component
// (display name + position chip — §2.4: NEVER "slide" in the Section
// Builder) · Status (operator words) · Fix (ONE action per row).
const MAPPING_TABLE_COLUMNS = [
  "Offer",
  "Provider",
  "Placement",
  "Field",
  "Expected type",
  "Required",
  "Mapped component",
  "Status",
  "Fix",
] as const;

// §2.1/§6-drawer (golden 370-387): a slim 42px bar — Mapping (with the same
// k/n badge as the top bar) · Validation · "Preview in a quote" (this IS the
// existing "preview" tab/panel — a Section preview is rendered "in a quote"
// context, so the golden copy just renames the existing mechanism) · (right)
// Preview-theme switcher (navigates to the Phase-D Themes manager route;
// harmless if that route doesn't exist yet — Phase D builds it) · Expand
// (toggles the drawer's max-height). "Design overrides" has NO golden
// position (§9.5's role-overrides UI predates this contract and isn't named
// in §2/Appendix A) — kept reachable (preserve-every-mechanism) as a smaller,
// visually-subordinate 4th control so it never competes with the 3 golden
// pills for attention.
export function renderStudioDrawer(summary: StudioMappingSummary, answerMapCount: number, sectionPublicId: string | null): string {
  // v3.1 §10.2 fix round (M1): same ?from= completion as renderStudioInspector's
  // Style-tab link, for the drawer's "Preview theme" → "Manage theme →" link.
  // No server-known "current preview theme_id" exists at this SSR point (the
  // <select id="lg-preview-theme"> is populated client-side from the live KV
  // list — the Section editor stores no theme itself), so &theme= is omitted
  // per the fix's own "optional; ?from is the required part" scoping.
  const manageThemeHref =
    sectionPublicId !== null ? `/admin/leadgen/themes?from=${encodeURIComponent(sectionPublicId)}` : "/admin/leadgen/themes";
  const mappingSummary = summary.publishable
    ? `<span class="badge badge-published" data-publishable="true">Publishable</span>`
    : `<span class="badge badge-archived" data-publishable="false">Blocked from publish</span>`;
  const missing =
    summary.required_missing_total > 0
      ? `<span class="lg-mapping-missing" data-required-missing="${summary.required_missing_total}">${summary.required_missing_total} required mapping${summary.required_missing_total === 1 ? "" : "s"} missing</span>`
      : `<span class="lg-mapping-missing" data-required-missing="0">All required fields mapped</span>`;
  const header = MAPPING_TABLE_COLUMNS.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("");
  // R4a S3-9/E3-S6: the SAME guard as the top-bar chip (renderStudioTopBar's
  // mappingBadgeColor/mappingBadgeBg) — green only when k===n (and n>0);
  // this was previously hardcoded green regardless of ratio (register
  // S3-9). Golden fidelity preserved for the TRUE/complete case (byte-exact
  // STUDIO_COLOR.success/mappingBadgeBg, golden :374) — only the FALSE case
  // is new (golden's own demo never depicts an incomplete drawer pill).
  // Inline (not a CSS class) so updateMappingBadge (island) can refresh it
  // live the SAME way it already refreshes the top-bar badge's inline style.
  const drawerMappingComplete = summary.required_fields_total > 0 && summary.required_mapped_total === summary.required_fields_total;
  const drawerMappingColor = drawerMappingComplete ? STUDIO_COLOR.success : STUDIO_COLOR.muted;
  const drawerMappingBg = drawerMappingComplete ? STUDIO_COLOR.mappingBadgeBg : STUDIO_COLOR.issuesChipBg;
  // The §8.7 panel: SSR renders the SKELETON (summary, E9 empty-state slot,
  // table head, expansion regions); the island fills it from
  // GET /sections/:id/offers + the live answer_maps model. Raw numeric offer
  // ids, free-text paths and raw JSON maps do NOT exist on this surface —
  // pickers only (Advanced drawer = the per-NODE raw JSON, §6.14).
  return `<div class="studio-drawer" data-studio-drawer style="border:0;border-top:1px solid ${STUDIO_COLOR.linePanel};border-radius:0;padding:0;background:${STUDIO_COLOR.white};margin-top:16px">
  <div class="studio-tabs" role="tablist" aria-label="Studio drawer tabs" style="display:flex;align-items:center;gap:4px;height:${STUDIO_GEOMETRY.bottomDrawerHeight}px;padding:0 14px;border-bottom:0;margin-bottom:0">
    <button type="button" class="studio-tab studio-drawer-tab" role="tab" data-studio-drawer-tab="mapping" aria-selected="false">Mapping <span data-studio-drawer-mapping-pill data-mapping-complete="${drawerMappingComplete}" style="font-size:10px;font-weight:800;color:${drawerMappingColor};background:${drawerMappingBg};padding:1px 6px;border-radius:10px;margin-left:4px">${summary.required_mapped_total}/${summary.required_fields_total}</span></button>
    <button type="button" class="studio-tab studio-drawer-tab" role="tab" data-studio-drawer-tab="validation" aria-selected="false">Validation</button>
    <button type="button" class="studio-tab studio-drawer-tab active" role="tab" data-studio-drawer-tab="preview" aria-selected="true">Preview in a quote</button>
    <!-- R5 D4 (register S4-A5/A6, operator decision 4): the "Design overrides"
         minor tab hides behind the QA-tools toggle too (default OFF) — the
         golden drawer bar shows exactly 3 items + theme switcher + Expand;
         with QA tools off this bar now matches that exactly. -->
    <span data-qa-tools-only hidden>
      <button type="button" class="studio-tab studio-drawer-tab-minor" role="tab" data-studio-drawer-tab="design" aria-selected="false" style="margin-left:8px;font-size:11px;color:${STUDIO_COLOR.faintSub};background:none;border:0;cursor:pointer;padding:4px 8px">Design overrides</button>
    </span>
    <div style="margin-left:auto;display:flex;align-items:center;gap:10px">
      <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:${STUDIO_COLOR.faintSub};font-weight:600;cursor:pointer" title="Shows developer/QA-only surfaces: the state simulator, sample answers, the events-would-fire log, and the Design-overrides tab">
        <input type="checkbox" id="lg-qa-tools-toggle" data-qa-tools-toggle style="margin:0" />
        QA tools
      </label>
      <div style="width:1px;height:20px;background:${STUDIO_COLOR.linePanel}"></div>
      <span style="width:13px;height:13px;border-radius:4px;background:${STUDIO_COLOR.navy};position:relative;display:inline-block"><span style="position:absolute;right:-2px;bottom:-2px;width:7px;height:7px;border-radius:2px;background:${STUDIO_COLOR.accent};border:1px solid ${STUDIO_COLOR.white}"></span></span>
      <label style="font-size:12px;color:${STUDIO_COLOR.muted};font-weight:600" for="lg-preview-theme">Preview theme:</label>
      <select id="lg-preview-theme" class="form-input" data-studio-preview-theme style="font-size:12px;padding:3px 6px;max-width:130px"><option value="">Navy (default)</option></select>
      <a href="${manageThemeHref}" data-studio-manage-theme-link style="font-size:12px;color:${STUDIO_COLOR.muted};font-weight:600;text-decoration:none">Manage theme &#8594;</a>
      <div style="width:1px;height:20px;background:${STUDIO_COLOR.linePanel}"></div>
      <button type="button" data-studio-drawer-expand aria-pressed="false" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:${STUDIO_COLOR.faintSub};cursor:pointer;background:none;border:0;padding:0">Expand<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="${STUDIO_COLOR.faintSub}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
  </div>
  <div class="studio-drawer-panel" data-studio-drawer-panel="mapping" hidden>
    <div class="lg-mapping-summary" data-mapping-summary data-studio-tab-mapping>${mappingSummary}${missing}<span class="form-help" data-studio-mapping-count>${answerMapCount} mapping edge${answerMapCount === 1 ? "" : "s"} on this Section</span></div>
    <p class="alert alert-error" data-studio-zero-offers-warning hidden role="status" aria-live="polite"></p>
    <p class="form-help" data-studio-offers-note>Loading matching Offers&#8230;</p>
    <div class="empty-state studio-offers-empty" data-studio-offers-empty hidden>
      <p data-studio-offers-empty-copy></p>
      <p>
        <a href="/admin/leadgen/offers" class="btn btn-sm btn-secondary" data-studio-open-offers>Open Offers</a>
        <button type="button" class="btn btn-sm btn-outline" data-studio-change-pair>Change Activity/Vertical</button>
      </p>
    </div>
    <div class="table-wrapper" data-studio-offers-table-wrap hidden>
      <table class="table studio-mapping-table" data-studio-mapping-table aria-label="Available Offers and mapping status">
        <thead><tr>${header}</tr></thead>
        <tbody data-studio-offers-body></tbody>
      </table>
    </div>
    <details class="lg-advanced studio-mapping-advanced" data-studio-mapping-advanced>
      <summary>Advanced: raw field paths</summary>
      <p class="form-help">Each Offer payload field&#8217;s raw dotted path &#8212; the table shows the field&#8217;s label; the raw path also rides each Field cell&#8217;s tooltip.</p>
      <ul class="studio-mapping-advanced-list" data-studio-mapping-advanced-list></ul>
    </details>
    <div class="studio-map-grid" data-studio-map-grid hidden></div>
    <div class="studio-bulk-review" data-studio-bulk-review hidden></div>
    <div class="studio-payload-preview" data-studio-payload-preview-wrap hidden>
      <div class="studio-events-head"><span class="form-label" data-studio-payload-preview-title>Generated payload preview</span><button type="button" class="btn btn-sm btn-outline" data-studio-payload-close>Close</button></div>
      <p class="form-help" data-studio-payload-note hidden>Unsaved mapping edits are NOT reflected — the payload preview validates the last SAVED mapping.</p>
      <pre data-studio-payload-preview></pre>
    </div>
  </div>
  <div class="studio-drawer-panel" data-studio-drawer-panel="validation" hidden>
    <p class="form-help">Structural issues, live from the studio model — the server re-validates on save. Click an issue to focus its component.</p>
    <ul class="studio-issue-list" data-studio-validation-list></ul>
  </div>
  <div class="studio-drawer-panel" data-studio-drawer-panel="design" hidden>
    ${renderSectionOverridesPanel()}
  </div>
  <div class="studio-drawer-panel" data-studio-drawer-panel="preview">
    ${renderPreviewPanel()}
  </div>
</div>`;
}

// §5.5 / §6.4 media picker — the SAME reusable affordance idiom the Quote
// Builder ships (ui-quotes.ts DEV-60 a): one shared in-page Media-library
// chooser (list + upload via the EXISTING /api/admin/media endpoints); the
// picked storage_key lands in the requesting choice-row input and flows
// through the SAME collectChoices path a typed value took.
// FIX 8c (§8.4): the picker additionally offers "Generate with AI" — ONE
// shared idiom with the Quote Builder's picker (ui-quotes.ts twin). It reuses
// the EXISTING admin generation endpoint (POST /api/admin/ai/image — writes
// R2 + a media row) and is HIDDEN when that route is unavailable (no key ⇒
// the endpoint 501s; the server stamps availability at render time).
function renderStudioMediaPicker(aiImageAvailable: boolean): string {
  return `<div class="lg-media-picker-overlay lg-hidden" id="lg-media-picker" role="dialog" aria-modal="true" aria-label="Choose from the Media library">
  <div class="lg-media-picker-panel">
    <div class="studio-events-head">
      <span class="form-label">Choose from the Media library</span>
      <button type="button" class="btn btn-sm btn-outline" id="lg-media-picker-close">Close</button>
    </div>
    <div class="studio-pair">
      <input type="file" id="lg-media-upload-file" accept="image/*" aria-label="Upload an image" />
      <button type="button" class="btn btn-sm btn-secondary" id="lg-media-upload-btn">Upload</button>
      <span class="form-help" id="lg-media-picker-status" role="status"></span>
    </div>
    <div class="studio-pair" data-media-ai-generate data-ai-image-available="${aiImageAvailable ? "true" : "false"}"${aiImageAvailable ? "" : " hidden"}>
      <input type="text" id="lg-media-ai-prompt" class="form-input" placeholder="Describe the image to generate&#8230;" aria-label="Describe the image to generate" />
      <button type="button" class="btn btn-sm btn-secondary" id="lg-media-ai-generate">Generate with AI</button>
    </div>
    <div class="lg-media-grid" id="lg-media-picker-grid"></div>
  </div>
</div>`;
}

// Initial (server-computed) issue count for the top-bar chip: the REAL
// validator's error count — the island recomputes its structural subset live.
export function initialIssueCount(content: LeadgenSectionContent): number {
  return validateSectionContent(content).errors.length;
}

// ---------------------------------------------------------------------------
// Assembly — the whole studio body below the tabs (ui-sections wraps it in
// the page shell and appends the #lg-section-data blob it owns).
// ---------------------------------------------------------------------------

export function renderSectionStudio(
  view: StudioSectionView,
  summary: StudioMappingSummary,
  statusPillHtml: string,
  mapsKeyConfigured: boolean,
  answerMapCount: number,
  // FIX 8c: whether POST /api/admin/ai/image is usable (OPENAI_API_KEY set).
  // false hides the picker's "Generate with AI" affordance (§8.4).
  aiImageAvailable = false,
): string {
  const design = getFunnelDesign(null);
  // §8.8 key-missing warning banner: SSR'd hidden; the island shows it ONLY
  // when the tree carries a Maps-enabled component AND no browser key is
  // configured (the exact no-op contract copy). Key state rides as a data
  // attribute so the island never needs a second bootstrap blob.
  const mapsBanner = `<p class="studio-maps-banner" data-studio-maps-banner data-maps-key-configured="${mapsKeyConfigured ? "true" : "false"}" hidden role="status" aria-live="polite">No Google-Maps browser key is configured &#8212; Autocomplete/validation will no-op; manual entry still works. The per-field Maps config stays saved and activates once the key is added.</p>`;
  // v3.1 audit-round G FIX 1a: the whole Studio page is wrapped in .studio-root
  // so the chrome's `var(--c-primary)` resolves to the golden's brand NAVY (§3),
  // scope-overriding the admin SHELL's generic #2563eb (layout.ts) WITHOUT
  // touching the shell — every other admin surface keeps its blue. The
  // wrapper spans top bar + strip + editor grid + drawer + pickers so
  // out-of-grid chrome (e.g. the strip's `.studio-hidden-show` link) is covered
  // too.
  return `<div class="studio-root">${renderStudioTopBar(view, summary, statusPillHtml, initialIssueCount(view.content))}
${renderStudioSettings(view, mapsKeyConfigured)}
${mapsBanner}
<div class="lg-editor-grid studio-grid">
  <div class="card studio-cell-library">${renderStudioLibrary(design, view.content)}</div>
  <div class="card studio-cell-canvas">${renderStudioCanvas(view.content, design, { headline_text: view.headline_text, subheadline_text: view.subheadline_text })}</div>
  <div class="card studio-cell-inspector">${renderStudioInspector(design, view.public_id)}</div>
</div>
${renderStudioDrawer(summary, answerMapCount, view.public_id)}
${renderStudioMediaPicker(aiImageAvailable)}
${renderStudioSeedData()}
${renderThemesOverlay()}</div>`;
}

// R5 D6 (register S4-A11, golden :627-721): the Themes manager opens as an
// IN-PAGE OVERLAY over the studio (golden's own interaction) instead of a
// full navigation — an <iframe> embedding the EXISTING /admin/leadgen/themes
// route (?embed=1, chromeless — see ui-theme-manager.ts) so 100% of the real
// theme-editing functionality is reused verbatim, just presented as a
// layered overlay. The standalone route still works unchanged for deep
// links. Hidden by default (SSR'd empty src — no request fires until
// opened).
function renderThemesOverlay(): string {
  return `<div class="studio-themes-overlay" data-themes-overlay hidden>
  <div class="studio-themes-overlay-backdrop" data-themes-overlay-backdrop></div>
  <iframe id="lg-themes-overlay-frame" class="studio-themes-overlay-frame" title="Themes manager" src="about:blank"></iframe>
</div>`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const SECTION_STUDIO_STYLES = `
/* v3.1 audit-round G FIX 1a: scope-override the admin shell's generic
   --c-primary (a non-golden blue defined in layout.ts) to the brand NAVY for the WHOLE
   Studio page only — every studio control that references var(--c-primary)
   (library hover, focus rings, scope-pill/tab active, segmented, swatches,
   links, add-condition) resolves NAVY here. The shell keeps its blue on all
   other admin surfaces (this variable is not touched in layout.ts). Gate 1b
   asserts this override is a §3 value so a future shell change can't silently
   re-blue the Studio. */
.studio-root{--c-primary:${STUDIO_COLOR.navy}}
/* R5 D6 (register S4-A11, golden :627-721): the Themes in-page overlay.
   [hidden] (ADMIN_STYLES' global rule) keeps this at zero layout impact
   until opened. Sized/positioned to echo the golden mockup's floating panel
   (1440x944, top:26px, centered) while staying responsive on real viewports
   the golden's fixed-size demo never had to handle. */
.studio-themes-overlay{position:fixed;inset:0;z-index:900}
.studio-themes-overlay-backdrop{position:absolute;inset:0;background:rgba(20,28,46,.35)}
.studio-themes-overlay-frame{position:absolute;left:50%;top:26px;transform:translateX(-50%);width:1440px;max-width:calc(100vw - 40px);height:calc(100vh - 52px);max-height:944px;border:0;border-radius:14px;box-shadow:0 24px 60px rgba(20,28,46,.30);background:#EDF0F4}
.studio-topbar{display:flex;align-items:flex-end;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.studio-topbar .form-group{margin:0}
/* R5 D7 (register S4-B7): golden's name slot is a TIGHT grouping (golden :39
   — the input itself is already width:132px) with no extra min-width padding
   the flex row out further; the min-width:220px here was the divergence
   (register B7), not the 132px input. Sized to content instead. */
.studio-name{min-width:0}
/* R5 D7 (register S4-A12): .studio-activity/.studio-vertical CSS was
   ORPHANED — no markup carries either class (Activity/Vertical live in
   .studio-pair pills, renderStudioSettings). Removed. */
.studio-chip{font-size:12px;border-radius:999px;padding:4px 10px;border:1px solid var(--c-border);background:var(--c-surface);cursor:pointer}
.studio-chip-validation[data-issue-count="0"]{color:${STUDIO_COLOR.muted};background:${STUDIO_COLOR.issuesChipBg};border-color:${STUDIO_COLOR.issuesChipBg}}
.studio-chip-validation:not([data-issue-count="0"]){color:${STUDIO_COLOR.warnStrong};background:${STUDIO_COLOR.warnTint};border-color:${STUDIO_COLOR.warn}}
.studio-settings{display:flex;flex-direction:column;gap:12px;margin-bottom:12px}
.lg-editor-grid{display:grid;grid-template-columns:${STUDIO_GEOMETRY.leftLibraryWidth}px 1fr ${STUDIO_GEOMETRY.rightInspectorWidth}px;gap:16px;align-items:start}
@media (max-width:1023px){.lg-editor-grid{grid-template-columns:1fr}}
.lg-editor-spacer{flex:1}
/* R5 D2 (register S4-A2): .lg-maps-note was the legacy Maps fieldset's OWN
   note-line class — orphaned now that the fieldset is removed. Removed. */
.lg-check{display:flex;align-items:center;gap:6px}
/* library */
.studio-library-search{margin-bottom:10px}
.studio-library-group{margin-bottom:16px}
.studio-library-heading{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--c-muted);margin:0 0 6px}
.studio-library-items{display:flex;flex-direction:column;gap:6px}
.studio-library-item{display:flex;gap:10px;width:100%;padding:8px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-surface);cursor:grab;text-align:left;align-items:flex-start;box-sizing:border-box;user-select:none}
.studio-library-item:hover{border-color:var(--c-primary)}
.studio-library-item:focus-visible{outline:2px solid var(--c-primary);outline-offset:2px}
.studio-library-item[data-search-hidden="true"]{display:none}
/* §5.2 bound palette items: disabled while their bound node exists */
.studio-library-item[data-bind-disabled="true"]{opacity:.45;cursor:not-allowed}
/* §8.3 frame callout + C7 scope note */
.studio-frame-callout{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;font-size:12px;color:#055160;background:#cff4fc;border:1px solid #b6effb;border-radius:8px;padding:8px 10px;margin:0 0 16px}
.studio-frame-callout-dismiss{border:0;background:none;cursor:pointer;font-size:14px;line-height:1;color:inherit;padding:0 2px}
.studio-frame-callout-open{font-weight:600}
.studio-scope-note{font-size:11px;color:var(--c-muted);margin:0 0 6px}
.studio-thumb{display:block;flex:0 0 84px;height:56px;overflow:hidden;border:1px solid var(--c-border);border-radius:6px;background:#fff;pointer-events:none;position:relative}
.studio-thumb-scale{display:block;transform:scale(.38);transform-origin:top left;width:264%;pointer-events:none}
.studio-item-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.studio-item-name{font-weight:600;font-size:13px}
.studio-item-desc{color:var(--c-muted);font-size:11px}
.studio-item-meta{display:flex;gap:6px;flex-wrap:wrap}
.studio-item-type{font-size:10px;color:var(--c-muted);font-variant-numeric:tabular-nums;border:1px solid var(--c-border);border-radius:4px;padding:0 4px}
.studio-item-maps{font-size:10px;color:#0f5132;background:#d1e7dd;border-radius:4px;padding:0 4px}
/* canvas */
.studio-breadcrumb{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#8A93A3;font-variant-numeric:tabular-nums}
/* v3.1 §6.1 canvas-toolbar undo/redo icon buttons (golden :277-278) */
.studio-undoredo-btn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border-radius:7px;cursor:pointer;border:0;background:none;padding:0}
.studio-undoredo-btn:hover{background:#F1F3F7}
.studio-undoredo-btn:disabled{opacity:.45;cursor:default}
.studio-undoredo-btn:disabled:hover{background:none}
.studio-toolbar{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0}
.studio-pending-note{font-size:12px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:4px 8px}
.studio-refusal{margin:8px 0}
/* v3.1 §2.2/§6.1 canvas surface (golden 294-296): dot-grid background,
   34/24 padding. Not a flex row (unlike golden's single wrapped 600px
   column) — this surface hosts an independently-sized REAL iframe (the
   viewport itself, 1280/375 — DEV-66 load-bearing for @media) alongside the
   decorative 600px-capped frame-hint skeletons, so each child centers via
   its OWN margin:auto instead of one shared flex wrapper. */
.studio-canvas-surface{border-radius:8px;min-height:320px;padding:34px 24px;position:relative;background:#EDF0F4;background-image:radial-gradient(#DCE1EA 1px,transparent 1px);background-size:22px 22px;overflow:auto}
.studio-canvas-surface:focus-visible{outline:2px solid var(--c-primary);outline-offset:2px}
/* DEV-66: the render region lives in the canvas srcdoc iframe — its viewport
   IS the §6.1.4 width (island swaps 1280/375); the region-decoration rules
   moved into SECTION_STUDIO_CANVAS_FRAME_CSS (inside the frame document). */
.studio-canvas-frame{display:block;border:0;width:1280px;max-width:none;height:320px;margin:0 auto;background:#fff}
.studio-canvas-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--c-muted);pointer-events:none}
/* v3.1 §6.3 frame-hint skeleton (golden 298-305/360-365): opacity/padding/
   pointer-events now ride the element's OWN inline style (byte-matching the
   golden literal — Gate 1a); user-select survives as the one property the
   golden's inline literal omits but the mechanism still needs (non-selectable
   presentation text). Appendix B's 600px unit-column width applies HERE
   (these decorative skeletons), not to the real 1280/375 iframe above. */
.studio-frame-skeleton{user-select:none;max-width:600px;margin:0 auto}
/* §5.4 amber badge rules moved into SECTION_STUDIO_CANVAS_FRAME_CSS (DEV-66) */
/* §5.1 hidden-in-unit chips next to the strip inputs */
.studio-hidden-chip{display:inline-block;font-size:11px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:999px;padding:2px 8px;margin-top:4px}
.studio-hidden-show{border:0;background:none;color:var(--c-primary);cursor:pointer;font-size:11px;padding:0;text-decoration:underline}
/* §5.2 legacy headline link banner */
.studio-bind-banner{font-size:12px;color:#055160;background:#cff4fc;border:1px solid #b6effb;border-radius:8px;padding:8px 10px;margin:0 0 12px}
.studio-bind-banner-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px 0}
.studio-bind-banner-value{font-weight:600}
/* §8.8 key-missing banner (the linked-field CHIP rule moved into the frame css) */
.studio-maps-banner{font-size:12px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:6px 10px;margin:0 0 12px}
/* §7.1 scope header + §7.2 pills */
.studio-scope-header{border-bottom:1px solid var(--c-border);padding:0 0 8px;margin:0 0 8px;transition:background-color .3s ease}
.studio-scope-header.studio-scope-flash{background:#fff3cd}
.studio-scope-editing{font-size:13px;margin:0 0 6px}
/* v3.1 audit-round G FIX 2: §8.1 affects line is a CREAM CALLOUT (golden :420
   — #FBFBF3 bg, #F0EAC9 border, radius 8, padding 8px 10px) with the accent
   star SVG and the blast-radius sentence (text #7A6B2E, bold segments #5C5015
   — golden :422-424). Colors are golden-sourced literals (Gate 1b tier-3). */
.studio-scope-affects{margin-top:11px;display:flex;align-items:flex-start;gap:7px;background:#FBFBF3;border:1px solid #F0EAC9;border-radius:8px;padding:8px 10px}
.studio-scope-affects svg{flex:0 0 auto;margin-top:1px}
.studio-scope-affects-text{font-size:11.5px;color:#7A6B2E;line-height:1.45}
.studio-scope-pills{display:flex;gap:4px;flex-wrap:wrap}
.studio-scope-pill{font-size:11px;border-radius:999px;padding:2px 10px;border:1px solid var(--c-border);background:var(--c-surface);cursor:pointer;color:var(--c-muted)}
/* v3.1 audit-round G FIX 1d: the ACTIVE scope pill is a SOLID navy chip with
   white text (golden :416 "This element": color:#fff;background:#1B3A5C;
   font-weight:700), not a navy-outlined/navy-text pill. */
.studio-scope-pill.active{border-color:${STUDIO_COLOR.navy};background:${STUDIO_COLOR.navy};color:${STUDIO_COLOR.white};font-weight:700}
.studio-scope-pill[disabled]{opacity:.5;cursor:not-allowed}
.studio-frame-pill-picker{display:inline-flex;gap:4px;flex-wrap:wrap;margin-left:6px}
.studio-cond-sentence{font-weight:600;color:var(--c-text,#1a1f36)}
.studio-section-scope-note{margin:0 0 8px}
/* inspector + drawer */
.studio-tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid var(--c-border);margin-bottom:10px}
.studio-tab{border:0;background:none;padding:6px 10px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--c-muted)}
/* v3.1 audit-round G FIX 1b: the ACTIVE inspector tab is navy text + a 2px
   ACCENT underline (golden :759 / Appendix B "Active tab underline: 2px
   #F5C518" — STUDIO_GEOMETRY.activeTabUnderline), NOT a navy underline. The
   underline color is STUDIO_COLOR.accent (the sole distinguishing value the
   previously-unused activeTabUnderline token encodes); text is var(--c-primary)
   = navy via the .studio-root scope. The bottom-drawer tabs carry their OWN
   .studio-drawer-tab.active rule (border:0, navy chip) and are unaffected. */
.studio-tab.active{border-bottom:2px solid ${STUDIO_COLOR.accent};color:var(--c-primary);font-weight:600}
.studio-tab[hidden]{display:none}
/* v3.1 §8 Phase C — the 5-tab inspector's new shared chrome (semantic
   classes + CSS custom properties, matching the rest of this file's idiom —
   NOT literal golden hex; §0's "translate the logic" doctrine). */
.studio-panel-eyebrow{font-size:10.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--c-muted);margin:12px 0 8px}
.studio-panel-eyebrow-row{display:flex;align-items:baseline;justify-content:space-between;margin:12px 0 8px}
.studio-panel-eyebrow-row .studio-panel-eyebrow{margin:0}
.studio-muted-note{font-size:11px;color:var(--c-muted);font-weight:500}
.studio-hr{height:1px;background:var(--c-border);margin:14px 0}
.studio-row-between{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.lg-check-label{font-size:13px;font-weight:600}
.studio-segmented{display:inline-flex;background:var(--c-surface-alt,#edf0f5);border-radius:6px;padding:2px;width:100%;margin-bottom:9px}
.studio-segmented button{flex:1;text-align:center;font-size:12px;font-weight:600;padding:6px 4px;border:0;background:none;color:var(--c-muted);cursor:pointer;border-radius:5px}
.studio-segmented button.active{background:var(--c-card,#fff);color:var(--c-primary);box-shadow:0 1px 2px rgba(16,24,40,.1)}
/* v3.1 audit-round G FIX 1c: §7.3 custom chip matches golden :529-531 — bg
   navyTint #EAF0F6, border #C7D6E6 (a golden-sourced hairline, NOT navy — so
   the var(--c-primary) border the shell blue leaked through is replaced),
   label navy (var(--c-primary) via .studio-root), sub #5E799B. */
.studio-custom-chip{display:flex;align-items:center;justify-content:space-between;gap:8px;background:${STUDIO_COLOR.navyTint};border:1px solid #C7D6E6;border-radius:8px;padding:8px 10px;margin-bottom:10px}
.studio-custom-chip-label{font-size:12.5px;font-weight:700;color:var(--c-primary)}
.studio-custom-chip-sub{font-size:10.5px;color:#5E799B}
.studio-swatch-row{display:flex;gap:9px;margin-bottom:12px}
.studio-swatch-row button{display:flex;flex-direction:column;align-items:center;gap:5px;border:0;background:none;cursor:pointer;font-size:10.5px;color:var(--c-muted);font-weight:600}
.studio-swatch-row button.active{color:var(--c-primary)}
.studio-swatch-row .studio-role-swatch{width:30px;height:30px;border-radius:8px}
.studio-inherited-row{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px;font-size:12.5px}
.studio-inherited-tag{font-size:9.5px;background:var(--c-surface-alt,#eef1f6);color:var(--c-muted);padding:1px 6px;border-radius:9px;margin-left:5px}
.studio-danger-link{border:0;background:none;color:#b23a2c;cursor:pointer;font-size:12.5px;font-weight:600;padding:0;text-decoration:underline}
.studio-callout-blue{background:#eaf1f8;border:1px solid #d4e2f0;color:#33506f;font-size:12px}
.studio-inline-note{background:var(--c-surface-alt,#f6f8fb);border-radius:6px;padding:8px 10px;color:var(--c-muted)}
.studio-connect-offers-card{background:#edf7f1;border:1px solid #cfe8db;border-radius:8px;padding:10px 12px}
.studio-connect-offers-card p{color:#1e6b41;font-weight:600;margin:0 0 4px}
.studio-rules-always-row{display:flex;align-items:center;gap:8px;padding:9px 11px;border:1px solid var(--c-border);border-radius:8px;margin-bottom:10px;background:var(--c-surface-alt,#f7f9fb)}
.studio-dot-green{width:8px;height:8px;border-radius:50%;background:#0e7c3a;flex:0 0 auto}
.studio-add-condition-btn{border:1px solid var(--c-primary);color:var(--c-primary);background:none;border-radius:6px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer}
.studio-maps-job-row{display:flex;gap:9px;align-items:flex-start;padding:10px;border:1px solid var(--c-border);border-radius:8px;margin-bottom:8px;cursor:pointer}
.studio-maps-job-row input{margin-top:2px}
.studio-maps-zero-job-banner{font-size:11.5px;padding:8px 10px;margin-bottom:10px}
.studio-maps-fills-block{margin:2px 0 8px;padding:10px;border:1px solid var(--c-border);border-radius:8px}
.studio-maps-fill-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--c-muted);margin-bottom:6px}
.studio-maps-fill-row:last-child{margin-bottom:0}
.studio-maps-fill-row select{flex:0 0 auto;min-width:160px}
.studio-mono-input{font-family:var(--font-mono,monospace);font-size:11.5px}
.studio-advanced-toggle{display:flex;align-items:center;gap:6px;padding:10px 0 4px;background:none;border:0;cursor:pointer;color:var(--c-muted);font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;width:100%;text-align:left}
.studio-advanced-toggle svg{transition:transform .15s ease}
.studio-advanced-toggle[aria-expanded="true"] svg{transform:rotate(90deg)}
.studio-advanced-body{padding-top:4px}
.lg-inspector-heading{font-size:13px;margin:0 0 8px}
.lg-inspector-field{margin-bottom:10px}
.lg-inspector-conditional{display:flex;gap:4px;flex-wrap:wrap;border:0;padding:0;margin:0}
.lg-choice-list{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.lg-choice-row{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.lg-choice-row .form-input{flex:1 1 90px;min-width:0}
/* v3.1 R3 S2-4/S2-5: labeled choice cells + emoji palette + image thumbnail */
.lg-choice-cell{display:flex;flex-direction:column;gap:2px;flex:1 1 96px;min-width:0}
.lg-choice-cell .form-input{flex:1 1 auto;width:100%;min-width:0}
.lg-choice-cell-label{font-size:10px;font-weight:600;color:#8A93A3;letter-spacing:.02em;text-transform:uppercase}
.lg-choice-image-row{display:flex;gap:4px;align-items:center}
.lg-choice-thumb{width:30px;height:30px;border-radius:6px;object-fit:cover;border:1px solid #eef1f6;flex:0 0 auto;background:#f6f8fb}
.lg-choice-emoji-head{display:flex;gap:6px;align-items:center}
.lg-choice-emoji-preview{font-size:18px;line-height:1;min-width:20px}
.lg-choice-emoji-palette{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px}
.lg-choice-emoji-btn{border:1px solid #eef1f6;background:#fff;border-radius:6px;font-size:15px;line-height:1;padding:3px 4px;cursor:pointer}
.lg-choice-emoji-btn:hover{background:#f2f6fa;border-color:#1B3A5C}
.lg-choice-icon-picker{display:flex;flex-direction:column;gap:3px;flex:1 1 auto;min-width:0}
.lg-choice-icon-custom{margin-top:2px}
.studio-debug-id{font-size:11px;color:var(--c-muted)}
.studio-advanced-json textarea{width:100%;font-family:var(--font-mono,monospace);font-size:11px;margin:6px 0}
.studio-rename-warning{font-size:12px}
.studio-drawer{margin-top:16px;border:1px solid var(--c-border);border-radius:8px;padding:12px;background:var(--c-surface)}
/* v3.1 §2.1 bottom-drawer bar (golden 370-387) — distinct from the generic
   .studio-tab/.studio-tab.active the Phase-C inspector strip also uses, so
   restyling here never bleeds into the inspector tabs (they never carry
   these classes). */
.studio-drawer-tab{display:inline-flex;align-items:center;gap:7px;padding:7px 13px;font-size:12.5px;font-weight:600;color:#6B7486;border-radius:7px;cursor:pointer;background:none;border:0}
.studio-drawer-tab:hover{background:#F1F3F7}
.studio-drawer-tab.active{font-weight:700;color:#1B3A5C;background:#EEF2F7}
.studio-drawer-tab-minor:hover{color:#41495B}
.studio-drawer-tab-minor.active{color:#1B3A5C;font-weight:700}
/* the drawer panel content area defaults to a capped, scrollable height;
   "Expand" (data-studio-drawer-expand) lifts the cap for a fuller working view */
.studio-drawer-panel{max-height:260px;overflow-y:auto;padding:12px 14px}
.studio-drawer-expanded .studio-drawer-panel{max-height:none}
/* v3.1 §4.1 top-bar hover states (golden style-hover, translated to real :hover) */
.studio-back:hover{background:#F5F7FA;border-color:#CDD5E1}
.studio-btn-save:hover{background:#16324f}
.studio-btn-archive:hover{background:#FBEEEC;color:#B23A2C}
.studio-issue-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.studio-issue-list button{border:0;background:none;color:#842029;cursor:pointer;text-align:left;font-size:12px;padding:2px 0}
.lg-mapping-summary{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}
.lg-mapping-missing{font-size:12px;color:var(--c-muted)}
/* preview (slice-C wiring, unchanged hooks) */
.lg-preview-frame{border:1px solid var(--c-border);border-radius:8px;width:100%;min-height:360px;margin-top:8px;background:#fff}
.lg-preview-frame-mobile{max-width:375px}
.lg-viewport-toggle,.lg-states-simulator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
/* v3.1 Phase E: these 5 selects (the drawer's 4 [data-frame-pick-*] pickers
   + the §8.9 design picker) are repopulated from ADMIN-WIDE, UNSCOPED lists
   (loadFramePickerQuotes() reads every Quote ever created, any operator,
   any funnel) -- with no width discipline a native select auto-sizes to
   its WIDEST option, so the box visibly grows as the Quote catalog grows.
   #lg-preview-theme (below) already closes this exact gap for the sibling
   theme picker; a max-width alone still lets the box shrink on sparse
   content (narrower on a fresh catalog than a grown one -- still content-
   dependent, still "drift"), so width is pinned too, removing the
   dependency entirely -- same fixed-width discipline this file's own gate1c
   baseline spec had to reach for as a TEST-side workaround before this
   product fix existed (leadgen-v31-gate1c-baselines.spec.ts).  */
.lg-preview-design{width:220px;max-width:220px;font-size:12px;padding:4px 6px}
.lg-dependency-panel{border:1px dashed var(--c-border);border-radius:6px;padding:8px;margin-bottom:8px}
.lg-dependency-panel textarea{width:100%;font-family:var(--font-mono,monospace);font-size:12px;margin-bottom:6px}
.lg-dependency-status{font-size:12px;margin:6px 0 0}
.lg-dependency-status[data-continue-blocked="true"]{color:#842029}
/* §8.2 activity/vertical pair controls */
.studio-pair{display:flex;gap:4px;align-items:center}
/* v3.1 Phase E: #lg-section-activity/#lg-section-vertical are repopulated
   (loadActivities()/loadVerticals()) from the ADMIN-WIDE, UNSCOPED
   /api/admin/leadgen/activities+/verticals lists -- every Section/Offer/
   Quote ever created, not just this one's own values -- so a floor-only
   min-width (the old rule) still lets the box grow unbounded as that
   catalog grows. Fixed width (matching the sibling .lg-preview-design
   discipline above) removes the content-dependence: the box never grows OR
   shrinks with catalog size, so a real operator's own Activity/Vertical
   layout stays stable regardless of how many other Activities/Verticals
   exist system-wide. 160px comfortably fits this contract's own fixture
   values ("Insurance"/"Car") with headroom. */
.studio-pair select{width:160px;max-width:160px}
/* §8.7 mapping panel */
.studio-mapping-table td,.studio-mapping-table th{font-size:12px;vertical-align:middle}
.studio-offers-empty p{margin:4px 0}
.studio-map-grid{border:1px dashed var(--c-border);border-radius:8px;padding:10px;margin-top:10px}
.studio-map-grid-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
.studio-map-row{display:grid;grid-template-columns:minmax(180px,1.2fr) minmax(180px,1.2fr) auto minmax(140px,1fr);gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--c-border)}
.studio-map-row:last-child{border-bottom:0}
.studio-map-row .form-input{font-size:12px;padding:4px 6px}
.studio-map-status{font-size:11px;border-radius:4px;padding:2px 6px;display:inline-block}
.studio-map-status[data-map-state="complete"]{color:#0f5132;background:#d1e7dd}
.studio-map-status[data-map-state="missing_required"]{color:#842029;background:#f8d7da}
.studio-map-status[data-map-state="type_mismatch"]{color:#664d03;background:#fff3cd}
.studio-map-status[data-map-state="orphaned"]{color:#41464b;background:#e2e3e5}
.studio-map-status[data-map-state="unmapped"]{color:var(--c-muted);background:var(--c-surface);border:1px solid var(--c-border)}
.studio-offer-state{font-size:11px;border-radius:999px;padding:2px 8px}
.studio-offer-state[data-offer-mapping-state="complete"]{color:#0f5132;background:#d1e7dd}
.studio-offer-state[data-offer-mapping-state="incomplete"]{color:#664d03;background:#fff3cd}
.studio-offer-state[data-offer-mapping-state="invalid"]{color:#842029;background:#f8d7da}
.studio-offer-state[data-offer-mapping-state="selected"]{color:#055160;background:#cff4fc}
.studio-offer-state[data-offer-mapping-state="not_selected"]{color:var(--c-muted);background:var(--c-surface);border:1px solid var(--c-border)}
.studio-bulk-review{border:1px dashed var(--c-border);border-radius:8px;padding:10px;margin-top:10px}
.studio-bulk-review ul{list-style:none;margin:6px 0;padding:0;display:flex;flex-direction:column;gap:4px}
.studio-payload-preview pre{max-height:260px;overflow:auto;background:#0b1021;color:#d8e0f0;border-radius:8px;padding:10px;font-size:11px}
.studio-inspector-mapping .studio-map-row{grid-template-columns:minmax(120px,1fr) minmax(140px,1.2fr) auto}
/* §8.9 events panel */
.studio-events{border:1px dashed var(--c-border);border-radius:6px;padding:8px;margin-bottom:8px}
.studio-events-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.studio-events-list{margin:6px 0 0;padding-left:18px;max-height:160px;overflow:auto;font-size:11px;font-family:var(--font-mono,monospace)}
/* §8.1/E6 layout hygiene: a compact-JSON event line is one unbreakable token —
   without wrap opportunities its min-content width propagates up the admin
   shell's flex chain and stretches the whole studio past the viewport. */
.studio-events-list li{padding:1px 0;overflow-wrap:anywhere;word-break:break-word}
.studio-events-list .studio-event-type{font-weight:600}
/* …and the flex item above the studio must be allowed to shrink below its
   content's intrinsic width (layout.ts .admin-main has flex:1 without a
   min-width — min-width:auto would keep the stretch). Scoped to the pages
   that inject the studio styles. */
.admin-main{min-width:0}
/* §9.2/§14.9 events probe: the hidden runtime document that keeps the §8.9
   stream alive while a NON-default sim shows a static main preview. */
.lg-events-probe-frame{position:absolute;left:-9999px;top:0;width:1px;height:1px;border:0}
/* §6.1 canvas toolbar (wave 2): always-visible bar, per-selection clusters */
.studio-toolbar{align-items:center}
.studio-tb-cluster{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap;padding:0 6px;border-left:1px solid var(--c-border)}
.studio-tb-cluster:first-of-type{border-left:0}
.studio-tb-group{display:inline-flex;gap:4px;align-items:center;flex-wrap:wrap}
.studio-tb-select{font-size:11px;padding:2px 4px;max-width:170px}
.studio-tb-check{font-size:11px}
/* v3.1 §6.1 breadcrumb (golden 266-272): plain muted root/intermediate
   crumbs; the CURRENT (deepest) crumb is the navy chip. */
.studio-breadcrumb button{border:0;background:none;color:#8A93A3;cursor:pointer;font-size:12.5px;font-weight:600;padding:0 2px}
.studio-breadcrumb .studio-crumb-current{color:#1B3A5C;font-weight:700;background:#EAF0F6;padding:3px 9px;border-radius:6px;cursor:default}
.studio-breadcrumb span:not(.studio-crumb-current){color:#C2CACF;padding:0 1px}
.studio-toolbar-problems{font-size:11px;color:#842029}
.studio-control-invalid{outline:2px solid ${STUDIO_COLOR.danger};outline-offset:1px}
/* §6.2 inline-edit + choice-op rules moved into SECTION_STUDIO_CANVAS_FRAME_CSS (DEV-66) */
/* §9.4 role swatch rows + §9.5 section overrides */
.studio-role-line{display:flex;gap:6px;align-items:center}
.studio-role-swatch{display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid var(--c-border);flex:0 0 16px}
.studio-role-source{margin:2px 0 0}
.studio-role-custom{color:#664d03;margin:2px 0 0}
.studio-link-btn{border:0;background:none;color:var(--c-primary);cursor:pointer;font-size:inherit;padding:0;text-decoration:underline}
.studio-overrides-banner{color:#055160;background:#cff4fc;border:1px solid #b6effb}
.studio-section-roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 16px;margin-bottom:10px}
.studio-section-role-row{display:flex;gap:6px;align-items:center}
.studio-section-role-row .form-label{margin:0;flex:0 0 120px;font-size:12px}
.studio-section-role-row .form-input{font-size:12px;padding:2px 4px}
/* §5.3 mode 5 frame picker */
.studio-frame-preview{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px;border:1px dashed var(--c-border);border-radius:6px;padding:6px 8px}
.studio-frame-empty{flex-basis:100%;color:#664d03;margin:2px 0 0}
/* §12.1 mapping-panel field rows */
.studio-offer-head td{background:var(--c-surface);border-top:2px solid var(--c-border)}
.studio-offer-name{font-weight:600}
.studio-provider-tag{font-size:10px;border-radius:999px;padding:1px 8px;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-muted);margin-left:6px;white-space:nowrap}
.studio-pos-chip{font-size:10px;border-radius:999px;padding:1px 6px;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-muted);margin-left:6px;white-space:nowrap}
.studio-row-status{font-size:11px;border-radius:999px;padding:2px 8px;white-space:nowrap}
.studio-row-status[data-row-status="complete"]{color:#0f5132;background:#d1e7dd}
.studio-row-status[data-row-status="needs-values"]{color:#664d03;background:#fff3cd}
.studio-row-status[data-row-status="type-mismatch"]{color:#842029;background:#f8d7da}
.studio-row-status[data-row-status="unlinked"]{color:#842029;background:#f8d7da}
.studio-row-status[data-row-status="not-mapped"]{color:var(--c-muted);background:var(--c-surface);border:1px solid var(--c-border)}
.studio-row-status[data-row-status="not-mapped"][data-row-required="true"]{color:#842029;background:#f8d7da;border:0}
.studio-mapping-advanced{margin:8px 0}
.studio-mapping-advanced-list{font-size:11px;color:var(--c-muted);margin:4px 0;padding-left:18px}
/* §12.3 overlay-chip rules moved into SECTION_STUDIO_CANVAS_FRAME_CSS (DEV-66) */
/* §7.3 provider-values chip (C1) */
.studio-provider-chip{font-size:10px;border-radius:999px;padding:1px 8px;border:1px solid var(--c-border);background:var(--c-surface);cursor:pointer;color:var(--c-muted)}
.studio-provider-rows{flex-basis:100%;font-size:11px;border-left:2px solid var(--c-border);padding-left:8px;margin:2px 0}
.studio-provider-rows a{font-size:11px}
/* §5.4 funnel-picker rule moved into SECTION_STUDIO_CANVAS_FRAME_CSS (DEV-66) */
/* choice rows: depth fields wrap */
.lg-choice-row{position:relative}
.lg-choice-row .studio-choice-reorder{display:inline-flex;gap:2px}
/* media picker (the ui-quotes idiom, studio-scoped) */
.lg-hidden{display:none !important}
.lg-media-picker-overlay{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px}
.lg-media-picker-panel{background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:10px;max-width:720px;width:100%;max-height:80vh;overflow:auto;padding:16px}
.lg-media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:10px}
.lg-media-item{border:1px solid var(--c-border);border-radius:8px;background:#fff;cursor:pointer;padding:4px;display:flex;flex-direction:column;gap:4px;align-items:center}
.lg-media-item img{max-width:100%;height:64px;object-fit:contain}
.lg-media-item span{font-size:10px;color:var(--c-muted);overflow-wrap:anywhere}
/* R4a S3-9/E3-S6: the drawer Mapping-tab pill's guard is INLINE style (both
   at SSR and via updateMappingBadge's live refresh) — see renderBottomDrawer/
   updateMappingBadge — matching the top-bar chip's own inline-style idiom
   exactly (no CSS class needed here). */
/* R4a deliverable 20: top-bar "Unsaved changes" state (dirty tracking already
   existed — markDirty/dirty; this is its first visible indicator). */
.studio-dirty-dot{display:none;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:${STUDIO_COLOR.warnStrong}}
.studio-dirty-dot[data-dirty="true"]{display:inline-flex}
.studio-dirty-dot::before{content:"";width:7px;height:7px;border-radius:50%;background:${STUDIO_COLOR.warn}}
/* R4a deliverable 1 (S3-3): a brief highlight pulse on the mapping drawer
   panel so switching to it from the Offers tab is visibly noticed, not a
   perceptual no-op. ~1.5s, then removed (JS strips the class on animationend). */
@keyframes studioMappingPulse{0%{box-shadow:0 0 0 0 rgba(27,58,92,.35)}100%{box-shadow:0 0 0 10px rgba(27,58,92,0)}}
.studio-mapping-pulse{animation:studioMappingPulse 1.5s ease-out 1}
/* R4a deliverable 8 (E3-NEW-7): the Delete undo toast — reuses the existing
   50-step history (historyUndo), never a blocking confirm(). */
.studio-undo-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);display:flex;align-items:center;gap:12px;background:${STUDIO_COLOR.ink};color:${STUDIO_COLOR.white};padding:10px 16px;border-radius:9px;box-shadow:0 6px 20px rgba(15,23,42,.35);font-size:12.5px;z-index:60}
.studio-undo-toast button{background:none;border:0;color:${STUDIO_COLOR.accent};font-weight:700;cursor:pointer;font-size:12.5px;padding:0}
`;

// ---------------------------------------------------------------------------
// The strict-ES5 studio island. One IIFE; no arrow/const/let/async/await/
// backtick (layout.ts constraint, asserted by the ES5 parse test). It owns the
// authoritative content model (a TREE — §8.5 containers carry children),
// seeded from the #lg-section-data blob; the canvas re-renders SERVER-side via
// POST /sections/preview (debounced) so what you see is the REAL preset
// renderer; the preview drawer keeps the slice-C wiring byte-compatible.
// ---------------------------------------------------------------------------

export const SECTION_STUDIO_SCRIPT = `
(function () {
  var dataEl = document.getElementById('lg-section-data');
  if (!dataEl) { return; }
  var state;
  try { state = JSON.parse(dataEl.textContent || '{}'); } catch (e) { state = {}; }
  if (!state.content || !state.content.components) { state.content = { components: [] }; }
  if (!state.answer_maps) { state.answer_maps = []; }
  if (!state.selected_offers) { state.selected_offers = []; }
  if (!state.offer_values) { state.offer_values = []; }
  if (state.design_overrides === undefined || typeof state.design_overrides !== 'object') { state.design_overrides = state.design_overrides || null; }

  var componentSeeds = {};
  var seedEl = document.getElementById('lg-component-seeds');
  if (seedEl) { try { componentSeeds = JSON.parse(seedEl.textContent || '{}'); } catch (e2) { componentSeeds = {}; } }
  var studioMeta = { max_depth: 4, types: {} };
  var metaEl = document.getElementById('lg-studio-meta');
  if (metaEl) { try { studioMeta = JSON.parse(metaEl.textContent || '{}'); } catch (e3) { studioMeta = { max_depth: 4, types: {} }; } }
  if (!studioMeta.types) { studioMeta.types = {}; }
  var MAX_DEPTH = studioMeta.max_depth || 4;
  // §9.1/§9.4: role → resolved default-design value (swatch chips + the
  // legacy-hex Convert exact match) and role → operator label.
  var ROLE_VALUES = studioMeta.roles || {};
  var ROLE_LABELS = studioMeta.role_labels || {};
  // v3.1 R3 S2-6: the Border-color swatches (data-border-swatch) map the node's
  // 3-value border_color vocabulary onto the §9.1 funnel-token roles the
  // renderer resolves against (presets.ts nodeBorderColorValue: neutral→border,
  // brand→brand_primary, accent→accent), so each swatch paints the SAME resolved
  // color the canvas would render — reusing the ROLE_VALUES map (the sibling
  // resolvedOverrideColor mechanism).
  var BORDER_SWATCH_ROLE = { neutral: 'border', brand: 'brand_primary', accent: 'accent' };

  var selectedQuestionId = null;
  var pendingInsert = null;
  var currentInspectorTab = 'content';
  var dirty = false;
  // §7.1/§7.2 inspector scope: 'section' (no selection) | 'component' |
  // 'choice' (a choice row focused / the Choice pill). 'frame' is never an
  // ACTIVE scope in the Section Builder — the frame is Quote-Builder-owned.
  var scopeState = 'section';
  // The focused choice's label for the §7.1 choice header copy.
  var choiceScopeLabel = '';
  // "Used in N quotes" (§7.1/§2.4) — from GET /sections/:id/usage; null until
  // loaded (or for a NEW Section).
  var usageQuoteCount = null;
  // §5.4/§5.3: the raw usage rows (funnels for Move-to-frame; empty state for
  // the mode-5 frame preview).
  var usageRows = [];
  // §6.1.4 canvas viewport (server-rendered param — never CSS-scaled).
  var canvasViewport = 'desktop';
  // §6.2/§6.4 per-choice selection: the focused choice VALUE within the
  // selected choice-bearing component (null = component scope).
  var selectedChoiceValue = null;
  // §6.6 loaded named presets (KV-backed via /component-presets).
  var presetsData = [];
  // §6.2 inline text editing pauses canvas re-renders until commit.
  var inlineEditing = false;
  // §6.1.3 undo/redo: bounded in-memory history of content-tree snapshots per
  // open editor. ≥30 required; 50 kept. Cleared on Save.
  var UNDO_LIMIT = 50;
  var undoStack = [];
  var redoStack = [];
  var lastSnapshot = JSON.stringify(state.content);
  // §7.3 Advanced raw JSON: read-only until the explicit "Edit raw…" confirm.
  var rawEditArmed = false;
  var DROP_CLASSES = ['studio-drop-before', 'studio-drop-after', 'studio-drop-into'];
  var SELECT_CLASS = 'studio-selected-node';

  // R4a deliverable 20: the top-bar "Unsaved changes" dot mirrors the
  // dirty flag (which every mutation already maintained — markDirty/the 3
  // dirty=false sites — this just makes the existing state VISIBLE).
  function renderDirtyIndicator() {
    var el = document.querySelector('[data-studio-dirty-indicator]');
    if (el) { el.setAttribute('data-dirty', dirty ? 'true' : 'false'); }
  }
  function markDirty() { dirty = true; renderDirtyIndicator(); }
  // §4.2 "On answer" segmented — ES5 mirror of the golden's seg() helper
  // (golden :741-745); the SSR-side segStyle() in the TS module sources the
  // identical literals from studio-tokens.ts (Gate-1b traceability at the
  // served-bytes layer). The ES5 island hardcodes them (matching the
  // golden's OWN hardcoded-literal idiom — Appendix D: "each returns the
  // exact active/inactive inline-style strings"); it cannot import the token
  // module at runtime.
  function segStyle(active) {
    return active
      ? 'padding:5px 11px;font-size:12px;font-weight:700;color:#1B3A5C;background:#fff;border-radius:6px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.12);white-space:nowrap'
      : 'padding:5px 11px;font-size:12px;font-weight:600;color:#6B7486;cursor:pointer;white-space:nowrap';
  }
  // Single writer for continue_mode (§5.5): both the strip's segmented
  // control and the canvas toolbar's quick auto-advance chip write the SAME
  // store through this one function, so the two views never drift.
  function setContinueMode(mode) {
    state.continue_mode = mode === 'auto_advance' ? 'auto_advance' : 'button';
    var waitOn = state.continue_mode !== 'auto_advance';
    var waitEl = document.querySelector('[data-continue-mode="button"]');
    var goEl = document.querySelector('[data-continue-mode="auto_advance"]');
    if (waitEl) { waitEl.setAttribute('style', segStyle(waitOn)); waitEl.setAttribute('aria-pressed', waitOn ? 'true' : 'false'); }
    if (goEl) { goEl.setAttribute('style', segStyle(!waitOn)); goEl.setAttribute('aria-pressed', waitOn ? 'false' : 'true'); }
    markDirty();
    updateCanvasToolbar();
  }
  function cloneJson(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return {}; } }
  function trimStr(s) { if (s === undefined || s === null) { return ''; } return String(s).trim(); }
  function clearChildren(el) { while (el.firstChild) { el.removeChild(el.firstChild); } }
  function newQuestionId() {
    return 'q_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
  }
  function typeMeta(type) { return studioMeta.types[type] || {}; }
  function isContainerType(type) { return typeMeta(type).container === true; }
  // Operator words everywhere (07 §7.4): the label from the served meta blob,
  // never a raw type id on a normal surface.
  function typeLabel(type) { return typeMeta(type).label || type; }

  // --- §6.1.3 undo/redo history (content-tree snapshots) -----------------------
  function updateHistoryButtons() {
    var u = document.querySelector('[data-studio-act="undo"]');
    var r = document.querySelector('[data-studio-act="redo"]');
    if (u) { u.disabled = undoStack.length === 0; }
    if (r) { r.disabled = redoStack.length === 0; }
  }
  // Called AFTER every model mutation (afterModelChange): pushes the PREVIOUS
  // snapshot, caps the stack, and invalidates the redo branch.
  function historyPush() {
    var now = JSON.stringify(state.content);
    if (now === lastSnapshot) { return false; }
    undoStack.push(lastSnapshot);
    if (undoStack.length > UNDO_LIMIT) { undoStack.shift(); }
    redoStack.length = 0;
    lastSnapshot = now;
    updateHistoryButtons();
    return true;
  }
  // Cleared on Save (§6.1.3) — and re-based on the saved content.
  function historyReset() {
    undoStack.length = 0;
    redoStack.length = 0;
    lastSnapshot = JSON.stringify(state.content);
    updateHistoryButtons();
  }
  function restoreSnapshot(snapshot) {
    state.content = JSON.parse(snapshot);
    lastSnapshot = snapshot;
    if (selectedQuestionId !== null && findRef(selectedQuestionId) === null) { selectedQuestionId = null; }
    refreshAfterHistory();
  }
  function historyUndo() {
    if (undoStack.length === 0) { return false; }
    redoStack.push(lastSnapshot);
    restoreSnapshot(undoStack.pop());
    return true;
  }
  function historyRedo() {
    if (redoStack.length === 0) { return false; }
    undoStack.push(lastSnapshot);
    restoreSnapshot(redoStack.pop());
    return true;
  }
  // The DOM refresh after a history restore — deliberately does NOT call
  // afterModelChange (that would push a new history entry).
  function refreshAfterHistory() {
    markDirty();
    clearRefusal();
    renderIssues();
    renderMapsBanner();
    renderBoundChips();
    updatePaletteBindItems();
    renderBindBanner();
    updateHistoryButtons();
    scheduleCanvasRender();
    selectComponent(selectedQuestionId);
  }

  // --- FIX 4b: pure per-type gates for the dead-write style controls -------------
  // Only renderCardGrid consumes columns/gridGap (the two card grids); the
  // multi-choice group renders NO icon slot, so its iconColor was a dead
  // write. Pure of the DOM so the gating semantics are directly executable.
  function isCardGridType(node) {
    return !!node && (node.type === 'IconCardAnswerGrid' || node.type === 'ImageCardAnswerGrid');
  }
  function isRangeFamilyType(node) {
    return !!node && (node.type === 'RangeQuestion' || node.type === 'CurrencyRangeQuestion' || node.type === 'NumberRangeQuestion');
  }
  // v3.1 R3b S2-7: iconColor/rangeColor were gated on the WRONG axis (shown
  // for every type except one, dead everywhere else) — now hidden EVERYWHERE
  // except their real consumer (renderCardGrid's icon slot / renderRange's
  // fill), the same "hidden unless this type's renderer consumes it"
  // discipline the Width/Height/Corners/Border quad already uses.
  function overrideRowHidden(rowKey, node) {
    if (rowKey === 'columns' || rowKey === 'gridGap') { return !isCardGridType(node); }
    if (rowKey === 'iconColor') { return !isCardGridType(node); }
    if (rowKey === 'rangeColor') { return !isRangeFamilyType(node); }
    return false;
  }

  // --- §6.5 context matrix (pure function of the selection) --------------------
  var TEXT_ROLE_TYPES = ['QuestionHeadline', 'Subheadline', 'CategoryLabel', 'HelperText', 'LegalNote'];
  function isCopyNode(node) {
    if (!node) { return false; }
    if (node.bind !== undefined) { return true; }
    return TEXT_ROLE_TYPES.indexOf(node.type) !== -1;
  }
  // The §6.5 rows, EXACT: base (nothing) = breadcrumb(root) · pills ·
  // undo/redo · viewport; each selection class ADDS its clusters. The preset
  // menu (§6.1.9) rides every unit-component selection (§6.6 apply needs a
  // same-type selection; the matrix table itself does not name it).
  function toolbarClustersFor(node, choiceFocused) {
    var base = ['breadcrumb', 'pills', 'undo', 'viewport'];
    if (!node) { return base; }
    if (choiceFocused) { return base.concat(['choice']); }
    var meta = typeMeta(node.type);
    if (meta.scope === 'frame') { return base.concat(['structure']); }
    if (isCopyNode(node)) { return base.concat(['text', 'structure', 'preset']); }
    if (meta.choice === true) { return base.concat(['structure', 'layout', 'component', 'preset']); }
    if (meta.produces) { return base.concat(['structure', 'component', 'preset']); }
    if (meta.container === true || meta.layout_props === true) { return base.concat(['structure', 'layout', 'preset']); }
    return base.concat(['structure', 'preset']);
  }

  // --- choice model helpers (§6.2/§6.4) ----------------------------------------
  function findChoice(node, value) {
    if (!node || !node.choices) { return null; }
    var i;
    for (i = 0; i < node.choices.length; i++) {
      if (String(node.choices[i].value) === String(value)) { return node.choices[i]; }
    }
    return null;
  }
  function choiceIndexOf(node, value) {
    if (!node || !node.choices) { return -1; }
    var i;
    for (i = 0; i < node.choices.length; i++) {
      if (String(node.choices[i].value) === String(value)) { return i; }
    }
    return -1;
  }
  function addChoiceToNode(node) {
    if (!node || typeMeta(node.type).choice !== true) { return null; }
    var req = typeMeta(node.type).required || {};
    if (!node.choices) { node.choices = []; }
    var n = node.choices.length + 1;
    var c = sampleChoice(req, n);
    while (findChoice(node, c.value) !== null) {
      n += 1;
      c = sampleChoice(req, n);
    }
    node.choices.push(c);
    afterModelChange();
    return c;
  }
  function removeChoiceFromNode(node, value) {
    var idx = choiceIndexOf(node, value);
    if (idx === -1) { return false; }
    node.choices.splice(idx, 1);
    if (String(selectedChoiceValue) === String(value)) { selectedChoiceValue = null; }
    afterModelChange();
    return true;
  }
  function moveChoice(node, value, delta) {
    var idx = choiceIndexOf(node, value);
    if (idx === -1) { return false; }
    var to = idx + delta;
    if (to < 0 || to >= node.choices.length) { return false; }
    var tmp = node.choices[idx];
    node.choices[idx] = node.choices[to];
    node.choices[to] = tmp;
    afterModelChange();
    return true;
  }
  function reorderChoiceBefore(node, fromValue, targetValue) {
    var from = choiceIndexOf(node, fromValue);
    var to = choiceIndexOf(node, targetValue);
    if (from === -1 || to === -1 || from === to) { return false; }
    var moved = node.choices.splice(from, 1)[0];
    if (from < to) { to -= 1; }
    node.choices.splice(to, 0, moved);
    afterModelChange();
    return true;
  }
  function duplicateChoice(node, value) {
    var idx = choiceIndexOf(node, value);
    if (idx === -1) { return null; }
    var clone = cloneJson(node.choices[idx]);
    var base = String(clone.value || 'option') + '_copy';
    var v = base, n = 2;
    while (findChoice(node, v) !== null) { v = base + n; n += 1; }
    clone.value = v;
    if (clone.analytics_id !== undefined) { clone.analytics_id = v; }
    node.choices.splice(idx + 1, 0, clone);
    afterModelChange();
    return clone;
  }
  function setChoiceField(node, value, field, v) {
    var c = findChoice(node, value);
    if (!c) { return false; }
    if (v === undefined || v === null || v === '' || v === false) { delete c[field]; }
    else { c[field] = v; }
    afterModelChange();
    return true;
  }

  // --- §6.1.5 Ungroup: dissolve a container, children splice into the parent ---
  function ungroupSelection(qid) {
    var ref = findRef(qid);
    if (!ref) { return null; }
    if (!isContainerType(ref.node.type) || !ref.node.children || ref.node.children.length === 0) {
      showRefusal('Only a container with children can be ungrouped.');
      return null;
    }
    var children = ref.node.children;
    var args = [ref.index, 1];
    var i;
    for (i = 0; i < children.length; i++) { args.push(children[i]); }
    Array.prototype.splice.apply(ref.list, args);
    selectedQuestionId = children[0].question_id;
    afterModelChange();
    return children;
  }

  // --- §6.2 container resize: snapped to the CardPanel width presets ONLY ------
  var WIDTH_PRESETS = ['s', 'm', 'l', 'full'];
  function snapWidthPreset(current, deltaPx) {
    var idx = WIDTH_PRESETS.indexOf(current || 'm');
    if (idx === -1) { idx = 1; }
    var next = idx + Math.round(deltaPx / 80);
    if (next < 0) { next = 0; }
    if (next > WIDTH_PRESETS.length - 1) { next = WIDTH_PRESETS.length - 1; }
    return WIDTH_PRESETS[next];
  }

  // --- §9.4 role-override helpers ------------------------------------------------
  var COLOR_OVERRIDE_KEYS = ['iconColor', 'featureColor', 'rangeColor', 'buttonBackground', 'buttonText'];
  var OVERRIDE_BACKING_ROLE = { buttonBackground: 'button_primary_bg', buttonText: 'button_primary_text' };
  function isHexColor(v) { return typeof v === 'string' && v.charAt(0) === '#'; }
  function roleLabelOf(role) { return ROLE_LABELS[role] || role; }
  // The §9.4 inheritance/source line — NO hex text on this surface (§9.6):
  // roles speak in labels; unmapped slots say "design default".
  function overrideSourceText(key, cur) {
    if (cur !== undefined && cur !== null && cur !== '') {
      if (isHexColor(cur)) { return 'Custom color \\u2014 not a theme role.'; }
      return roleLabelOf(cur) + ' \\u2014 overridden for this component.';
    }
    var backing = OVERRIDE_BACKING_ROLE[key] || null;
    if (backing !== null) {
      var repointed = (state.design_overrides && state.design_overrides.palette) ? state.design_overrides.palette[backing] : null;
      if (repointed) {
        return 'Inherited: ' + (isHexColor(repointed) ? 'Custom color' : roleLabelOf(repointed)) + ' \\u2014 from this Section\\u2019s Design overrides.';
      }
      return 'Inherited: ' + roleLabelOf(backing) + ' \\u2014 from the base design.';
    }
    return 'Inherited: design default \\u2014 from the base design.';
  }
  function resolvedOverrideColor(key, cur) {
    if (isHexColor(cur)) { return cur; }
    if (cur && ROLE_VALUES[cur]) { return ROLE_VALUES[cur]; }
    var backing = OVERRIDE_BACKING_ROLE[key] || null;
    if (backing !== null) {
      var rep = (state.design_overrides && state.design_overrides.palette) ? state.design_overrides.palette[backing] : null;
      if (isHexColor(rep)) { return rep; }
      if (rep && ROLE_VALUES[rep]) { return ROLE_VALUES[rep]; }
      return ROLE_VALUES[backing] || '';
    }
    return '';
  }
  // Convert a stored legacy #hex to the role whose DEFAULT-design value is an
  // exact (case-insensitive) match; no match → the operator picks (§9.4).
  function legacyHexToRole(hex) {
    if (!isHexColor(hex)) { return null; }
    var lower = String(hex).toLowerCase();
    var r;
    for (r in ROLE_VALUES) {
      if (Object.prototype.hasOwnProperty.call(ROLE_VALUES, r) && String(ROLE_VALUES[r]).toLowerCase() === lower) { return r; }
    }
    return null;
  }

  // --- §9.5 Section-level overrides (the Design-overrides drawer mode) ----------
  // FIX 2: this editor owns ONLY the §9.5 keys (palette / columnsDefault /
  // gapDefault). Every OTHER key on the LOADED design_overrides — the legacy
  // curated Section-level bag (§14.8) and any stored key this editor does not
  // model — is preserved VERBATIM (stored key order first), so a save with
  // untouched §9.5 controls round-trips a pure-legacy bag byte-identically.
  function buildSectionOverrides() {
    var out = {};
    var palette = {};
    var any = false, pAny = false;
    var loaded = (state.design_overrides && typeof state.design_overrides === 'object') ? state.design_overrides : null;
    var k;
    if (loaded) {
      for (k in loaded) {
        if (!Object.prototype.hasOwnProperty.call(loaded, k)) { continue; }
        if (k === 'palette' || k === 'columnsDefault' || k === 'gapDefault') { continue; }
        out[k] = loaded[k];
        any = true;
      }
    }
    var sels = document.querySelectorAll('[data-section-role]');
    var i, role, v;
    for (i = 0; i < sels.length; i++) {
      role = sels[i].getAttribute('data-section-role');
      v = trimStr(sels[i].value);
      if (v !== '') { palette[role] = v; pAny = true; }
    }
    if (pAny) { out.palette = palette; any = true; }
    var colsEl = document.querySelector('[data-section-columns-default]');
    if (colsEl && trimStr(colsEl.value) !== '') {
      var n = Number(colsEl.value);
      if (!isNaN(n)) { out.columnsDefault = n; any = true; }
    }
    var gapEl = document.querySelector('[data-section-gap-default]');
    if (gapEl && trimStr(gapEl.value) !== '') { out.gapDefault = gapEl.value; any = true; }
    return any ? out : null;
  }

  // --- §6.6 preset model: capture + apply ---------------------------------------
  // The layout-prop capture whitelist (mirrors the server's
  // PRESET_LAYOUT_PROP_KEYS — the POST rejects anything else).
  var PRESET_PROP_KEYS = ['direction', 'gap', 'align', 'columnsDesktop', 'columnsTablet', 'columnsMobile', 'sizing', 'ratio', 'mobile', 'width', 'background', 'shadow', 'radius', 'padding', 'size', 'gradient', 'layout', 'image_fit'];
  function presetsForType(type) {
    var out = [], i;
    for (i = 0; i < presetsData.length; i++) {
      if (presetsData[i] && presetsData[i].component_type === type) { out.push(presetsData[i]); }
    }
    return out;
  }
  function presetByName(name) {
    var i;
    for (i = 0; i < presetsData.length; i++) {
      if (presetsData[i] && presetsData[i].name === name) { return presetsData[i]; }
    }
    return null;
  }
  // §6.6 capture: type + curated design_overrides + LAYOUT props — NEVER
  // content/choices/mapping (scalar whitelist).
  function buildPresetPayload(node) {
    var overrides = {};
    var propsSubset = {};
    var k, v;
    var ov = node.design_overrides || {};
    for (k in ov) {
      if (Object.prototype.hasOwnProperty.call(ov, k)) { overrides[k] = ov[k]; }
    }
    var props = node.props || {};
    for (k in props) {
      if (!Object.prototype.hasOwnProperty.call(props, k)) { continue; }
      if (PRESET_PROP_KEYS.indexOf(k) === -1) { continue; }
      v = props[k];
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { propsSubset[k] = v; }
    }
    return { component_type: node.type, overrides: overrides, props_subset: propsSubset };
  }
  // §6.6 apply = MERGE onto the selected node of the SAME type; the stored
  // design_preset field holds the preset NAME as provenance only.
  function applyPreset(node, preset) {
    if (!node || !preset || node.type !== preset.component_type) { return false; }
    var k;
    var ov = preset.overrides || {};
    for (k in ov) {
      if (Object.prototype.hasOwnProperty.call(ov, k)) { ensureObj(node, 'design_overrides')[k] = ov[k]; }
    }
    var ps = preset.props_subset || {};
    for (k in ps) {
      if (Object.prototype.hasOwnProperty.call(ps, k)) { ensureObj(node, 'props')[k] = ps[k]; }
    }
    node.design_preset = preset.name;
    cleanupEmpty(node, 'design_overrides');
    cleanupEmpty(node, 'props');
    afterModelChange();
    return true;
  }

  // --- §7.3 C1: the read-only per-Offer provider-values projection ---------------
  // Rows = ONE PER SELECTED OFFER (state.offer_values — the DEV-55 SSR blob
  // projection): the offer's provider value for this choice, or null ("not
  // set"). No control on the Choices surface writes a provider value.
  function providerChipRows(internalField, choiceValue) {
    var rows = [], i, entry, fieldEntry, v;
    var list = state.offer_values || [];
    for (i = 0; i < list.length; i++) {
      entry = list[i];
      if (!entry) { continue; }
      fieldEntry = (entry.fields && internalField) ? entry.fields[internalField] : null;
      v = (fieldEntry && fieldEntry.values) ? fieldEntry.values[choiceValue] : undefined;
      rows.push({
        offer_name: String(entry.offer_name || entry.offer_id),
        offer_public_id: entry.offer_public_id || null,
        value: (v === undefined || v === null) ? null : String(v),
        href: entry.offer_public_id ? ('/admin/leadgen/offers/' + encodeURIComponent(entry.offer_public_id) + '/edit#payload') : null
      });
    }
    return rows;
  }
  function providerChipLabel(internalField, choiceValue) {
    var rows = providerChipRows(internalField, choiceValue);
    var set = 0, i;
    for (i = 0; i < rows.length; i++) { if (rows[i].value !== null) { set += 1; } }
    return 'Provider values: ' + set + '/' + rows.length + ' Offers';
  }

  // --- §5.4 Move to funnel layout: the equivalent frame_config_json group -------
  // Legacy frame-scope node → the sparse §3.3 group the funnel frame PUT
  // accepts (closed enums; role colours; arrays replaced whole).
  function equivalentFrameGroup(node) {
    var t = node.type;
    var p = node.props || {};
    var i;
    if (t === 'ProgressBar') {
      // FIX 3: the REAL legacy mode value is 'step' (the preset's enum —
      // props: mode(step|percent)); 'steps' never existed, so the numbered
      // mapping was dead. A label on the legacy node carries as show_label.
      var progress = { style: p.mode === 'step' ? 'numbered' : 'percent' };
      if (typeof p.label === 'string' && p.label !== '') { progress.show_label = true; }
      return { progress: progress };
    }
    if (t === 'StepIndicator') { return { progress: { style: 'dots' } }; }
    if (t === 'HeaderLogo') {
      if (typeof p.logoMediaId === 'string' && p.logoMediaId !== '') {
        return { header: { enabled: true, logo_source: 'manual', logo_media_id: p.logoMediaId } };
      }
      return { header: { enabled: true, logo_source: 'site' } };
    }
    if (t === 'BackButton') {
      return { back: { style: 'text', label: (typeof p.label === 'string' && p.label !== '') ? p.label : 'Back' } };
    }
    if (t === 'DisclosureLink') {
      return { disclosure: { enabled: true, text: typeof p.panelHtml === 'string' ? p.panelHtml : '' } };
    }
    if (t === 'HeaderBar') {
      var header = { enabled: true };
      if (typeof p.logoMediaId === 'string' && p.logoMediaId !== '') {
        header.logo_source = 'manual';
        header.logo_media_id = p.logoMediaId;
      }
      if (p.secure === true) {
        header.secure_badge = { enabled: true, text: (typeof p.secureText === 'string' && p.secureText !== '') ? p.secureText : null };
      }
      if (p.cta && typeof p.cta === 'object' && typeof p.cta.label === 'string' && p.cta.label !== '') {
        header.cta = {
          enabled: true,
          label: p.cta.label,
          href: typeof p.cta.href === 'string' ? p.cta.href : null,
          tel: typeof p.cta.tel === 'string' ? p.cta.tel : null
        };
      }
      var headerGroup = { header: header };
      if (typeof p.backLabel === 'string' && p.backLabel !== '') { headerGroup.back = { label: p.backLabel }; }
      return headerGroup;
    }
    if (t === 'FooterBar') {
      var footer = { enabled: true };
      if (p.links && p.links.length) {
        var links = [], l;
        for (i = 0; i < p.links.length; i++) {
          l = p.links[i];
          if (l && typeof l.label === 'string' && typeof l.href === 'string') { links.push({ label: l.label, href: l.href }); }
        }
        if (links.length > 0) { footer.links_source = 'manual'; footer.links = links; }
      }
      if (p.trustMessages && p.trustMessages.length) { footer.trust_text = p.trustMessages.join(' \\u00B7 '); }
      if (typeof p.legalHtml === 'string' && p.legalHtml !== '') { footer.description = p.legalHtml; }
      return { footer: footer };
    }
    if (t === 'BackgroundPanel') {
      // FIX 1b: a background image on the legacy panel moves WITH it — the
      // frame group carries image_media_id (frames.ts background.fields).
      var background = { style: p.gradient ? 'brand_gradient' : 'brand' };
      if (typeof p.imageMediaId === 'string' && p.imageMediaId !== '') { background.image_media_id = p.imageMediaId; }
      return { background: background };
    }
    return null;
  }
  // Group-level merge over the STORED sparse config: our group's fields win;
  // arrays replace whole (§13.2 discipline).
  function mergeFrameGroups(stored, group) {
    var out = (stored && typeof stored === 'object') ? cloneJson(stored) : {};
    var k, gk, sub;
    for (k in group) {
      if (!Object.prototype.hasOwnProperty.call(group, k)) { continue; }
      sub = (out[k] && typeof out[k] === 'object' && !(out[k] instanceof Array)) ? out[k] : {};
      for (gk in group[k]) {
        if (Object.prototype.hasOwnProperty.call(group[k], gk)) { sub[gk] = group[k][gk]; }
      }
      out[k] = sub;
    }
    return out;
  }
  // The distinct funnels using this Section (from the usage rows).
  // quote_public_id rides along (ADDITIVE) — the MINOR-9 frame-pill deep link
  // targets the owning Quote's builder page.
  function usageFunnelsOf() {
    var seen = {}, out = [], i, r;
    for (i = 0; i < usageRows.length; i++) {
      r = usageRows[i];
      if (!r || !r.funnel_public_id || seen[r.funnel_public_id] === true) { continue; }
      seen[r.funnel_public_id] = true;
      out.push({ public_id: r.funnel_public_id, name: r.funnel_name || r.funnel_public_id, quote_public_id: r.quote_public_id || null });
    }
    return out;
  }
  // R4a E3-NEW-4: the distinct QUOTES using this Section (from the SAME
  // usage rows usageFunnelsOf reads) — auctions are quote-scoped
  // (LeadgenAuctionApi.quote_id), not funnel-scoped, so the "Open auction
  // rules" resolution keys on quotes rather than funnels.
  function usageQuotesOf() {
    var seen = {}, out = [], i, r;
    for (i = 0; i < usageRows.length; i++) {
      r = usageRows[i];
      if (!r || !r.quote_public_id || seen[r.quote_public_id] === true) { continue; }
      seen[r.quote_public_id] = true;
      out.push(r.quote_public_id);
    }
    return out;
  }
  // R4a E3-NEW-4: "Open auction rules ->" pointed at /admin/leadgen/rules,
  // which never existed (register); the real surface is the SINGULAR
  // /admin/leadgen/auction (ui.ts). A Section has no direct auction FK, but
  // the auctions LIST API already supports ?quote= (auctions-handlers.ts
  // listAuctionsHandler) — so the one resolvable case (exactly one quote
  // uses this Section) can reach its ONE auction directly. Zero quotes, or
  // more than one quote (ambiguous — which one?), or zero/many auctions on
  // that quote all fall back to the honest unscoped list (never a disabled
  // no-op — the same "never dead" rule openQuoteBuilderNav follows; the
  // auctions LIST PAGE has no ?quote= UI filter to scope a fallback to,
  // unlike the funnel picker's in-page toggle, so "many" stays unscoped
  // rather than inventing a filtered destination that doesn't exist yet).
  function openAuctionRulesNav() {
    var quotes = usageQuotesOf();
    if (quotes.length !== 1) { window.location.href = '/admin/leadgen/auction'; return; }
    fetch('/api/admin/leadgen/auctions?quote=' + encodeURIComponent(quotes[0]), {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (j) {
      var items = (j && j.items) || [];
      if (items.length === 1 && items[0] && items[0].public_id) {
        window.location.href = '/admin/leadgen/auction/' + encodeURIComponent(items[0].public_id) + '/edit';
      } else {
        window.location.href = '/admin/leadgen/auction';
      }
    }).catch(function () { window.location.href = '/admin/leadgen/auction'; });
  }
  // MINOR 9: the "Funnel frame" pill deep-links to the using funnel's Quote
  // Builder page (frames are Quote-Builder-owned).
  function funnelQuoteUrl(funnel) {
    if (funnel && funnel.quote_public_id) { return '/admin/leadgen/quotes/' + encodeURIComponent(funnel.quote_public_id) + '/edit'; }
    return '/admin/leadgen/quotes';
  }
  function framePillPickBtn(funnel) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline';
    b.setAttribute('data-frame-pill-pick', funnel.public_id);
    b.appendChild(document.createTextNode(funnel.name));
    b.addEventListener('click', function () { window.location.href = funnelQuoteUrl(funnel); });
    return b;
  }
  // Many using funnels → a picker next to the clicked pill (toggle on
  // re-click); one → direct navigation; zero → the pill stays disabled.
  function renderFramePillPicker(host, funnels) {
    var parent = host.parentNode;
    if (!parent) { return; }
    var existing = parent.querySelector ? parent.querySelector('[data-frame-pill-picker]') : null;
    if (existing) { parent.removeChild(existing); return; }
    var wrap = document.createElement('span');
    wrap.setAttribute('data-frame-pill-picker', '');
    wrap.className = 'studio-frame-pill-picker';
    var i;
    for (i = 0; i < funnels.length; i++) {
      wrap.appendChild(framePillPickBtn(funnels[i]));
    }
    parent.appendChild(wrap);
  }
  // v3.1 R3b deliverable 1 (S2-2 reclassified): the ONE shared "open the real
  // Quote Builder" navigation every frame-owned deep link uses — 0 funnels ->
  // the quotes LIST (an honest destination, never a disabled no-op); 1 ->
  // navigate straight to its Quote Builder page; many -> the SAME picker the
  // 'frame' scope pill already renders (toggled next to the clicked trigger).
  // Reused by: the Continue Content-tab "Open Quote Builder ->" link, the
  // Continue Style-tab's 3 "Edit in Quote Builder ->" row buttons, and the
  // frame-scope read-only notice's own deep link (deliverable 8).
  function openQuoteBuilderNav(triggerEl) {
    var funnels = usageFunnelsOf();
    if (funnels.length === 0) { window.location.href = funnelQuoteUrl(null); return; }
    if (funnels.length === 1) { window.location.href = funnelQuoteUrl(funnels[0]); return; }
    renderFramePillPicker(triggerEl, funnels);
  }
  // §5.4: the explicit confirm NAMES the funnel — and, for a container with
  // children, NAMES what happens to them (FIX 1c: the contents are NOT
  // deleted; they splice into this Section where the container stood).
  function moveConfirmMessage(node, funnelName) {
    var contentsNote = '';
    if (isContainerType(node.type) && node.children && node.children.length > 0) {
      contentsNote = ' Its contents stay in this Section.';
    }
    return 'Move this ' + typeLabel(node.type) + ' into the funnel layout of \\u201C' + funnelName + '\\u201D?\\nIt leaves this Section and becomes part of that funnel\\u2019s layout (edited in the Quote Builder).' + contentsNote + ' The Section change saves now.';
  }

  // --- §5.3 mode 5: Preview with funnel layout ----------------------------------
  var framePick = { quote: '', funnel: '', variant: '', site: '' };
  var framePickFunnels = [];
  function frameContextBody() {
    if (framePick.funnel === '') {
      // §5.3 mode-5 empty state (MINOR 15): the Section is used by ZERO
      // Quotes — the unit previews inside the DEFAULT template frame
      // (frame_context {default:true} — template defaults, no branding),
      // exactly what the empty-state copy promises. The typeof guard keeps
      // the function pure of load order (usage may not be loaded yet).
      if (typeof usageQuoteCount !== 'undefined' && usageQuoteCount === 0) { return { 'default': true }; }
      return null;
    }
    var ctx = { funnel_public_id: framePick.funnel };
    if (framePick.variant !== '') { ctx.variant_public_id = framePick.variant; }
    if (framePick.site !== '') { ctx.site_id = framePick.site; }
    return ctx;
  }

  // --- §6.7 inline validation problems at the control ---------------------------
  function issueControlKeyOf(message) {
    var m = message.match(/needs its ([A-Za-z_]+)$/);
    if (m) { return m[1]; }
    m = message.match(/needs a numeric ([A-Za-z_]+)$/);
    if (m) { return m[1]; }
    if (message.indexOf('needs an internal field') !== -1) { return 'internal_field'; }
    if (message.indexOf('needs at least one choice') !== -1) { return 'choices'; }
    return null;
  }

  // --- §6.1.7 text cluster: type-role conversion --------------------------------
  // "Type role" maps to the design type slots = the catalog's copy types.
  // Converting TO the headline/subheadline roles is refused (§5.2: free-text
  // extra headlines are not insertable — the BOUND node is the one headline).
  function convertTextRole(qid, newType) {
    var ref = findRef(qid);
    if (!ref) { return false; }
    if (ref.node.bind !== undefined) { return false; }
    if (TEXT_ROLE_TYPES.indexOf(ref.node.type) === -1 || TEXT_ROLE_TYPES.indexOf(newType) === -1) { return false; }
    if (ref.node.type === newType) { return false; }
    if (newType === 'QuestionHeadline' || newType === 'Subheadline') {
      showRefusal('This Section already shows its ' + (newType === 'Subheadline' ? 'subheadline' : 'headline') + ' \\u2014 use the shared field instead.');
      return false;
    }
    var props = ref.node.props || {};
    var text = typeof props.text === 'string' ? props.text : (typeof props.html === 'string' ? props.html : '');
    var key = newType === 'LegalNote' ? 'html' : 'text';
    var replacement = { type: newType, question_id: ref.node.question_id, props: {} };
    replacement.props[key] = text !== '' ? text : defaultTextFor(newType, key);
    ref.list[ref.index] = replacement;
    afterModelChange();
    return true;
  }

  // §5.5: dropdown "searchable" toggle — a pure TYPE swap between the two
  // dropdown components (same props/choices; the §8.3 searchable variant).
  function toggleSearchableDropdown(node) {
    if (!node) { return false; }
    if (node.type === 'DropdownQuestion') { node.type = 'SearchableDropdownQuestion'; }
    else if (node.type === 'SearchableDropdownQuestion') { node.type = 'DropdownQuestion'; }
    else { return false; }
    afterModelChange();
    return true;
  }

  // §5.6 "Cards" type-swap — Icon / Image / Plain, matching the golden's
  // Content-tab "Card style" setting. Choices carry over UNCHANGED (label/
  // value/analytics_id survive every swap); type-specific choice fields
  // (icon / imageMediaId+image_alt) simply go unread by a target type that
  // doesn't consume them — NEVER synthesized (no fake icon/image invented).
  var CARD_STYLE_TYPES = { icon: 'IconCardAnswerGrid', image: 'ImageCardAnswerGrid', plain: 'ButtonAnswerGroup' };
  var CARD_STYLE_FAMILY = ['IconCardAnswerGrid', 'ImageCardAnswerGrid', 'ButtonAnswerGroup'];
  function cardStyleOf(node) {
    if (!node) { return null; }
    if (node.type === 'IconCardAnswerGrid') { return 'icon'; }
    if (node.type === 'ImageCardAnswerGrid') { return 'image'; }
    if (node.type === 'ButtonAnswerGroup') { return 'plain'; }
    return null;
  }
  function setCardStyle(node, style) {
    var target = CARD_STYLE_TYPES[style];
    if (!node || !target) { return false; }
    if (CARD_STYLE_FAMILY.indexOf(node.type) === -1) { return false; }
    if (node.type === target) { return false; }
    node.type = target;
    afterModelChange();
    return true;
  }

  // §5.6 "Slider" type-swap — Format $ toggles NumberRangeQuestion <->
  // CurrencyRangeQuestion (props/choices carry over unchanged).
  function toggleSliderFormat(node) {
    if (!node) { return false; }
    if (node.type === 'NumberRangeQuestion') { node.type = 'CurrencyRangeQuestion'; }
    else if (node.type === 'CurrencyRangeQuestion') { node.type = 'NumberRangeQuestion'; }
    else { return false; }
    afterModelChange();
    return true;
  }

  // §5.6 "The Accept-swap rule" — all 8 text-input tiles insert ONE control
  // whose Accept dropdown selects the concrete stored type, PRESERVING
  // shared props on swap (internal_field/label/helper/icon/required survive;
  // only the type-specific validation/format prop changes). The reverse map
  // mirrors content-schema.ts's LEADGEN_FIELD_ACCEPT_TYPE (the ES5 island
  // cannot import — hardcoded here matching the golden's own per-state
  // literal idiom, Appendix D).
  var ACCEPT_FORMAT_TYPE = {
    text: 'FreeTextQuestion',
    number: 'NumberInputQuestion',
    currency: 'CurrencyInputQuestion',
    email: 'EmailInputQuestion',
    phone: 'PhoneInputQuestion',
    us_zip: 'ZIPInputQuestion',
    date: 'DateQuestion',
    street_address: 'AddressAutocompleteQuestion'
  };
  var ACCEPT_TYPE_FORMAT = {
    FreeTextQuestion: 'text',
    NumberInputQuestion: 'number',
    CurrencyInputQuestion: 'currency',
    EmailInputQuestion: 'email',
    PhoneInputQuestion: 'phone',
    ZIPInputQuestion: 'us_zip',
    DateQuestion: 'date',
    AddressAutocompleteQuestion: 'street_address'
  };
  function acceptFormatOfNode(node) { return node ? (ACCEPT_TYPE_FORMAT[node.type] || null) : null; }
  function setAcceptFormat(node, format) {
    var target = ACCEPT_FORMAT_TYPE[format];
    if (!node || !target) { return false; }
    if (!ACCEPT_TYPE_FORMAT[node.type]) { return false; }
    node.type = target;
    if (!node.props) { node.props = {}; }
    node.props.format = format;
    afterModelChange();
    return true;
  }

  // --- §6.2 inline text editing (dblclick) commit core ---------------------------
  // Bound nodes write the STRIP store (one store, two views); plain copy nodes
  // write props.text/label; choice cards write that choice's label.
  function inlineEditKeyFor(node) {
    if (node.bind !== undefined) { return 'bind'; }
    var cp = typeMeta(node.type).content_props || [];
    if (cp.indexOf('text') !== -1) { return 'text'; }
    if (cp.indexOf('label') !== -1) { return 'label'; }
    // R2 S1-7 / E1-C4: the text-input family edits its PLACEHOLDER in place.
    // DateQuestion is EXCLUDED — a native date control's placeholder is a
    // browser no-op (the control is hidden in R3); returning null here keeps
    // the native dblclick behavior (no preventDefault) for a date field.
    if (node.type !== 'DateQuestion' && cp.indexOf('placeholder') !== -1) { return 'placeholder'; }
    return null;
  }
  function commitInlineText(qid, key, text) {
    var ref = findRef(qid);
    if (!ref) { return false; }
    if (key === 'bind') {
      var strip = stripInputFor(ref.node.bind);
      if (strip) { strip.value = text; }
      var mirror = document.querySelector('[data-bound-shared-input="' + ref.node.bind + '"]');
      if (mirror && strip) { mirror.value = strip.value; }
      markDirty();
      scheduleCanvasRender();
      return true;
    }
    var props = ensureObj(ref.node, 'props');
    if (trimStr(text) === '') { delete props[key]; } else { props[key] = text; }
    cleanupEmpty(ref.node, 'props');
    afterModelChange();
    return true;
  }
  function commitInlineChoiceLabel(qid, value, text) {
    var ref = findRef(qid);
    if (!ref) { return false; }
    var c = findChoice(ref.node, value);
    if (!c) { return false; }
    c.label = text;
    afterModelChange();
    return true;
  }
  // The contenteditable session: Enter/blur commits, Escape cancels; canvas
  // re-renders are paused while editing (scheduleCanvasRender re-checks).
  function startInlineEdit(el, committer) {
    if (inlineEditing || !el) { return false; }
    inlineEditing = true;
    el.setAttribute('contenteditable', 'true');
    if (el.focus) { el.focus(); }
    function finish(apply) {
      if (!inlineEditing) { return; }
      inlineEditing = false;
      el.removeAttribute('contenteditable');
      el.removeEventListener('blur', onBlur);
      el.removeEventListener('keydown', onKey);
      if (apply) { committer(el.textContent || ''); } else { scheduleCanvasRender(); }
    }
    function onBlur() { finish(true); }
    function onKey(keyEv) {
      // The terminating keys are consumed HERE — stop propagation so the
      // doc-level onCanvasKeyDown never sees them: finish() clears
      // inlineEditing BEFORE the event bubbles up, so under that handler's
      // flag guard alone the Escape that cancels the edit would ALSO walk
      // the selection to the parent.
      if (keyEv.key === 'Enter') { keyEv.preventDefault(); keyEv.stopPropagation(); finish(true); }
      else if (keyEv.key === 'Escape') { keyEv.preventDefault(); keyEv.stopPropagation(); finish(false); }
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
    return true;
  }
  // R2 S1-7: inline-edit a text field's PLACEHOLDER in place. A bare <input>
  // has no editable text content (contenteditable is a no-op on it), so —
  // unlike startInlineEdit's contenteditable session — this swaps the input's
  // VALUE to the current placeholder, lets the operator edit it natively (an
  // input is always type-editable), then commits value -> props.placeholder and
  // restores the input's original (preview) value. The canvas input never
  // carries a real answer in the studio, so borrowing its value for the edit is
  // side-effect-free. Enter/blur commit, Escape cancels — the SAME lifecycle as
  // startInlineEdit; inlineEditing pauses the debounced re-render meanwhile.
  function startPlaceholderEdit(inputEl, qid) {
    if (inlineEditing || !inputEl) { return false; }
    var ref = findRef(qid);
    if (!ref) { return false; }
    inlineEditing = true;
    var props = ref.node.props || {};
    var original = inputEl.value;
    inputEl.value = (props.placeholder === undefined || props.placeholder === null) ? '' : String(props.placeholder);
    if (inputEl.focus) { inputEl.focus(); }
    if (inputEl.select) { inputEl.select(); }
    function finish(apply) {
      if (!inlineEditing) { return; }
      inlineEditing = false;
      inputEl.removeEventListener('blur', onBlur);
      inputEl.removeEventListener('keydown', onKey);
      var typed = inputEl.value;
      inputEl.value = original;
      if (apply) { commitInlineText(qid, 'placeholder', typed); } else { scheduleCanvasRender(); }
    }
    function onBlur() { finish(true); }
    function onKey(keyEv) {
      if (keyEv.key === 'Enter') { keyEv.preventDefault(); keyEv.stopPropagation(); finish(true); }
      else if (keyEv.key === 'Escape') { keyEv.preventDefault(); keyEv.stopPropagation(); finish(false); }
    }
    inputEl.addEventListener('blur', onBlur);
    inputEl.addEventListener('keydown', onKey);
    return true;
  }

  // --- §5.2 canonical headline binding model helpers ---------------------------
  // ONE store, two views: headline_text/subheadline_text live in the strip
  // inputs; a BOUND QuestionHeadline/Subheadline canvas node renders that
  // store (server-side sectionCtx). These helpers are the island's bind core.
  function bindForType(type) {
    if (type === 'QuestionHeadline') { return 'section_headline'; }
    if (type === 'Subheadline') { return 'section_subheadline'; }
    return null;
  }
  function bindNoun(bindValue) { return bindValue === 'section_subheadline' ? 'subheadline' : 'headline'; }
  function bindNodeType(bindValue) { return bindValue === 'section_subheadline' ? 'Subheadline' : 'QuestionHeadline'; }
  function stripInputFor(bindValue) {
    return document.getElementById(bindValue === 'section_subheadline' ? 'lg-section-subheadline' : 'lg-section-headline');
  }
  function findBoundNode(bindValue) {
    var found = null;
    walkTree(state.content.components, 1, function (n) {
      if (found === null && n.bind === bindValue) { found = n; }
    });
    return found;
  }
  // The FIRST (top-most) unbound node of the bind's type — the legacy-banner
  // link candidate (§5.2: never auto-mutated; the operator clicks).
  function unboundCandidate(bindValue) {
    var type = bindNodeType(bindValue);
    var found = null;
    walkTree(state.content.components, 1, function (n) {
      if (found === null && n.type === type && n.bind === undefined) { found = n; }
    });
    return found;
  }
  // §5.2 "[Show]" chip action: re-insert the bound node AT THE TOP.
  function insertBoundNodeAtTop(bindValue) {
    if (findBoundNode(bindValue) !== null) { return null; }
    var node = { type: bindNodeType(bindValue), question_id: newQuestionId(), bind: bindValue };
    state.content.components.splice(0, 0, node);
    afterModelChange();
    return node;
  }
  // §5.2 legacy-banner action: link an unbound node to the canonical column.
  // winnerText === null keeps the current strip value (byte-equal case);
  // otherwise the operator-picked text WINS and is written into the strip
  // store first. The node drops props.text and gains the bind marker — the
  // model changes NOW (dirty), persistence happens on Save (never on load).
  function linkBoundNode(qid, bindValue, winnerText) {
    var ref = findRef(qid);
    if (!ref || findBoundNode(bindValue) !== null) { return false; }
    var strip = stripInputFor(bindValue);
    if (winnerText !== null && strip) { strip.value = winnerText; }
    ref.node.bind = bindValue;
    if (ref.node.props) {
      delete ref.node.props.text;
      cleanupEmpty(ref.node, 'props');
    }
    afterModelChange();
    return true;
  }

  // --- model tree helpers ----------------------------------------------------
  function walkTree(list, depth, fn) {
    var i, node;
    for (i = 0; i < list.length; i++) {
      node = list[i];
      if (!node || typeof node !== 'object') { continue; }
      fn(node, depth);
      if (isContainerType(node.type) && node.children && node.children.length) {
        walkTree(node.children, depth + 1, fn);
      }
    }
  }

  function findRefIn(list, qid, depth, trail) {
    var i, node, hit;
    for (i = 0; i < list.length; i++) {
      node = list[i];
      if (!node || typeof node !== 'object') { continue; }
      if (node.question_id === qid) {
        return { list: list, index: i, node: node, depth: depth, trail: trail.concat([node]), parent: trail.length ? trail[trail.length - 1] : null };
      }
      if (isContainerType(node.type) && node.children && node.children.length) {
        hit = findRefIn(node.children, qid, depth + 1, trail.concat([node]));
        if (hit) { return hit; }
      }
    }
    return null;
  }
  function findRef(qid) { return findRefIn(state.content.components, qid, 1, []); }
  function selectedNode() {
    if (selectedQuestionId === null) { return null; }
    var ref = findRef(selectedQuestionId);
    return ref ? ref.node : null;
  }
  function breadcrumbText(qid) {
    // §7.4: the breadcrumb is a normal surface — operator labels, never raw
    // type ids.
    var ref = findRef(qid);
    if (!ref) { return ''; }
    var parts = [], i;
    for (i = 0; i < ref.trail.length; i++) { parts.push(typeLabel(ref.trail[i].type)); }
    return parts.join(' \\u203A ');
  }
  function isInSubtree(node, qid) {
    if (!node || typeof node !== 'object') { return false; }
    if (node.question_id === qid) { return true; }
    var i;
    if (node.children) {
      for (i = 0; i < node.children.length; i++) { if (isInSubtree(node.children[i], qid)) { return true; } }
    }
    return false;
  }
  function subtreeMaxContainerDepth(node, depth) {
    var best = isContainerType(node.type) ? depth : 0;
    var i, d;
    if (isContainerType(node.type) && node.children) {
      for (i = 0; i < node.children.length; i++) {
        d = subtreeMaxContainerDepth(node.children[i], depth + 1);
        if (d > best) { best = d; }
      }
    }
    return best;
  }
  function fieldExists(name) {
    var found = false;
    walkTree(state.content.components, 1, function (n) { if (n.internal_field === name) { found = true; } });
    return found;
  }
  function uniqueFieldName(base) {
    var name = base + '_copy', n = 2;
    while (fieldExists(name)) { name = base + '_copy' + n; n += 1; }
    return name;
  }
  function internalFieldsOf() {
    var fields = [];
    walkTree(state.content.components, 1, function (n) {
      if (n.internal_field && trimStr(n.internal_field) !== '') { fields.push(n.internal_field); }
    });
    return fields;
  }
  function refFieldInfo(fieldName) {
    var info = { type: 'string', choices: null };
    walkTree(state.content.components, 1, function (n) {
      if (n.internal_field === fieldName) {
        var m = typeMeta(n.type);
        info.type = n.answer_type || m.produces || 'string';
        if (n.choices && n.choices.length) { info.choices = n.choices; }
      }
    });
    return info;
  }
  function findConditionalRefs(fieldName) {
    var refs = [];
    if (!fieldName) { return refs; }
    walkTree(state.content.components, 1, function (n) {
      if (n.conditional && n.conditional.when === fieldName) { refs.push(n.question_id); }
    });
    return refs;
  }

  // --- §9 field-level Maps config model helpers (Phase C job-based shape) -----
  // Legacy flat-key spellings (runtime/maps.ts parseMapsConfig's liberal
  // parse) stay recognized for OLD stored content — the new UI (below) only
  // ever authors the {enabled, jobs} shape.
  function mapsConfigOf(node) {
    var m = node && node.props ? node.props.maps : null;
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : null;
  }
  // The autofilled part names, in the runtime's link order (street, city,
  // state, zip) — reading BOTH the flat autofill_* spelling and the nested
  // fills object exactly like parseMapsConfig's pick(). Retained for OLD
  // stored content's canvas chip decoration (buildFrameBadge sibling); the
  // new Maps tab authors no fills object (§9 — no per-field autofill-target
  // picker in the golden design; FLAGGED contract gap, see final report).
  function mapsFillLabels(node) {
    var cfg = mapsConfigOf(node);
    if (!cfg) { return []; }
    var nested = (cfg.fills && typeof cfg.fills === 'object') ? cfg.fills : {};
    var parts = ['street', 'city', 'state', 'zip'];
    var out = [], i, v;
    for (i = 0; i < parts.length; i++) {
      v = cfg['autofill_' + parts[i]] !== undefined ? cfg['autofill_' + parts[i]] : nested[parts[i]];
      if (typeof v === 'string' && trimStr(v) !== '') { out.push(parts[i]); }
    }
    return out;
  }
  // Maps-enabled = the per-field config switches SOMETHING on: the NEW
  // {enabled:true} shape, any OLD flat flag (either spelling parseMapsConfig
  // accepts), or an autofill target on legacy stored content.
  function nodeMapsEnabled(node) {
    var cfg = mapsConfigOf(node);
    if (!cfg) { return false; }
    if (cfg.enabled === true) { return true; }
    if (cfg.enable_autocomplete === true || cfg.autocomplete === true) { return true; }
    if (cfg.validate_full_address === true || cfg.validate_zip === true || cfg.validate === true) { return true; }
    if (cfg.normalize_address_line === true || cfg.normalize === true) { return true; }
    return mapsFillLabels(node).length > 0;
  }

  // --- validity-ready node factory (seed + REQUIRED_FIELDS projection) -------
  function slugify(s) {
    var out = '', i, ch, lower = String(s).toLowerCase();
    for (i = 0; i < lower.length; i++) {
      ch = lower.charAt(i);
      if ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')) { out += ch; }
      else if (out.length > 0 && out.charAt(out.length - 1) !== '_') { out += '_'; }
    }
    while (out.length > 0 && out.charAt(out.length - 1) === '_') { out = out.slice(0, out.length - 1); }
    return out;
  }
  function sampleChoice(req, n) {
    var c = { label: 'Option ' + n, value: 'option_' + n, analytics_id: 'option_' + n };
    if (req.choice_icon) { c.icon = '\\u2605'; }
    // A5: image_alt ALWAYS rides imageMediaId — §8.4 requires it on an
    // ImageCardAnswerGrid choice, so an alt-less sample would fail save.
    if (req.choice_image) { c.imageMediaId = 'media_option_' + n; c.image_alt = c.label; }
    return c;
  }
  function defaultTextFor(type, key) {
    if (key === 'html' || key === 'panelHtml') { return 'Copy for ' + type; }
    if (key === 'logoMediaId') { return 'media_logo'; }
    return 'New ' + type + ' text';
  }
  function makeNode(type) {
    // §5.2: the palette's "Question headline" / "Subheadline" ALWAYS insert
    // BOUND nodes (no props.text — the text IS the Section column). Free-text
    // extra headlines are not insertable (CategoryLabel/HelperText cover
    // kicker/support copy). addComponentAt refuses when a bound node exists.
    var bindValue = bindForType(type);
    if (bindValue !== null) {
      return { type: type, question_id: newQuestionId(), bind: bindValue };
    }
    var seed = componentSeeds[type];
    var node = seed ? cloneJson(seed) : {};
    var req = typeMeta(type).required || {};
    node.type = type;
    node.question_id = newQuestionId();
    if (req.internal_field) { node.internal_field = 'field_' + node.question_id.slice(2); }
    if (req.choices) { node.choices = [sampleChoice(req, 1), sampleChoice(req, 2)]; }
    else if (node.choices && node.choices.length === 0) { delete node.choices; }
    var i, k, list;
    list = req.text_props || [];
    for (i = 0; i < list.length; i++) {
      k = list[i];
      if (!node.props) { node.props = {}; }
      if (trimStr(node.props[k]) === '') { node.props[k] = defaultTextFor(type, k); }
    }
    list = req.numeric_props || [];
    for (i = 0; i < list.length; i++) {
      k = list[i];
      if (!node.props) { node.props = {}; }
      if (typeof node.props[k] !== 'number') { node.props[k] = (k === 'max' ? 100 : 0); }
    }
    // v3.1 R3b E2-C2: TextBlock has NO required text_props (every prop is
    // optional per REQUIRED_FIELDS.TextBlock), so the generic loop above never
    // seeds anything — a fresh insert rendered a real, present, but VISUALLY
    // EMPTY heading (propStr(node,'text') undefined -> esc("") -> nothing on
    // screen). A real default role+text so a new TextBlock is visible the
    // moment it lands, exactly like every other primitive's seed.
    if (type === 'TextBlock') {
      if (!node.props) { node.props = {}; }
      if (trimStr(node.props.role) === '') { node.props.role = 'heading'; }
      if (trimStr(node.props.text) === '') { node.props.text = 'New text'; }
    }
    return node;
  }

  // --- structural mutations (§8.4) — every mutation flows through here --------
  // §5.6 "Contact" tile (4th param, optional): a Stack of three individually
  // editable/deletable nodes (NameFieldsGroup + EmailInputQuestion +
  // PhoneInputQuestion). Reuses EVERY existing insertion rule (bound-node
  // refusal, container depth cap, pendingInsert targeting) — children are
  // attached to the constructed node BEFORE the single afterModelChange()
  // call, so the whole Contact group is ONE atomic history entry. defaultProps
  // (5th param, optional, m2): shallow-merged onto the new node's props
  // BEFORE afterModelChange — the Divider tile's variant:"line" is the first
  // consumer.
  function addComponentAt(type, parentQid, index, childTypes, defaultProps) {
    // §5.2: at most ONE bound node per bind value — a second insert is refused
    // with the exact palette tooltip copy (the palette item is also disabled;
    // this guard covers drag-drop and container drops too).
    var bindValue = bindForType(type);
    if (bindValue !== null && findBoundNode(bindValue) !== null) {
      showRefusal('This Section already shows its ' + bindNoun(bindValue));
      return null;
    }
    var target = state.content.components;
    var depth = 1;
    var ref;
    if (parentQid) {
      ref = findRef(parentQid);
      if (!ref || !isContainerType(ref.node.type)) { return null; }
      if (!ref.node.children) { ref.node.children = []; }
      target = ref.node.children;
      depth = ref.depth + 1;
    }
    if (isContainerType(type) && depth > MAX_DEPTH) {
      showRefusal('Cannot nest a ' + typeLabel(type) + ' deeper than ' + MAX_DEPTH + ' container levels — drop refused.');
      return null;
    }
    var node = makeNode(type);
    if (childTypes && childTypes.length) {
      node.children = [];
      var ci;
      for (ci = 0; ci < childTypes.length; ci++) { node.children.push(makeNode(childTypes[ci])); }
    }
    if (defaultProps) {
      if (!node.props) { node.props = {}; }
      for (var dpKey in defaultProps) {
        if (Object.prototype.hasOwnProperty.call(defaultProps, dpKey)) { node.props[dpKey] = defaultProps[dpKey]; }
      }
    }
    var at = (typeof index === 'number' && index >= 0 && index <= target.length) ? index : target.length;
    target.splice(at, 0, node);
    afterModelChange();
    return node;
  }
  function insertRelative(qid, where, type, childTypes, defaultProps) {
    var ref = findRef(qid);
    if (!ref) { return null; }
    var parentQid = ref.parent ? ref.parent.question_id : null;
    return addComponentAt(type, parentQid, ref.index + (where === 'after' ? 1 : 0), childTypes, defaultProps);
  }
  function moveNodeTo(qid, parentQid, index) {
    var ref = findRef(qid);
    if (!ref) { return false; }
    if (parentQid === qid) { return false; }
    if (parentQid && isInSubtree(ref.node, parentQid)) {
      showRefusal('Cannot move a container into its own children.');
      return false;
    }
    var target = state.content.components;
    var depth = 1;
    var pref = null;
    if (parentQid) {
      pref = findRef(parentQid);
      if (!pref || !isContainerType(pref.node.type)) { return false; }
      if (!pref.node.children) { pref.node.children = []; }
      target = pref.node.children;
      depth = pref.depth + 1;
    }
    if (subtreeMaxContainerDepth(ref.node, depth) > MAX_DEPTH) {
      showRefusal('Cannot nest containers deeper than ' + MAX_DEPTH + ' levels — drop refused.');
      return false;
    }
    var at = (typeof index === 'number' && index >= 0) ? index : target.length;
    if (target === ref.list && ref.index < at) { at -= 1; }
    ref.list.splice(ref.index, 1);
    if (at > target.length) { at = target.length; }
    target.splice(at, 0, ref.node);
    afterModelChange();
    return true;
  }
  function moveWithin(qid, delta) {
    var ref = findRef(qid);
    if (!ref) { return; }
    var to = ref.index + delta;
    if (to < 0 || to >= ref.list.length) { return; }
    var tmp = ref.list[ref.index];
    ref.list[ref.index] = ref.list[to];
    ref.list[to] = tmp;
    afterModelChange();
  }
  function removeNode(qid) {
    var ref = findRef(qid);
    if (!ref) { return; }
    ref.list.splice(ref.index, 1);
    if (selectedQuestionId === qid) { selectedQuestionId = null; }
    afterModelChange();
  }
  function regenerateIds(node) {
    node.question_id = newQuestionId();
    if (node.question_key !== undefined) { delete node.question_key; }
    if (node.internal_field) { node.internal_field = uniqueFieldName(node.internal_field); }
    // §5.2/§3.4: at most one node per bind value — a duplicated subtree DETACHES
    // any bound node into a plain text snapshot of the current canonical value
    // (the legacy-link banner can re-offer binding if the operator deletes the
    // original later).
    if (node.bind !== undefined) {
      var strip = stripInputFor(node.bind);
      delete node.bind;
      if (!node.props) { node.props = {}; }
      node.props.text = strip ? strip.value : '';
    }
    var i;
    if (node.children) { for (i = 0; i < node.children.length; i++) { regenerateIds(node.children[i]); } }
  }
  function duplicateNode(qid) {
    var ref = findRef(qid);
    if (!ref) { return null; }
    // §5.2: the bound headline/subheadline is the Section's ONE canonical
    // text — duplicating it directly is refused (a duplicate would be a
    // second free-text headline, which is not insertable).
    if (ref.node.bind !== undefined) {
      showRefusal('This Section already shows its ' + bindNoun(ref.node.bind) + ' — the shared ' + bindNoun(ref.node.bind) + ' cannot be duplicated.');
      return null;
    }
    var clone = cloneJson(ref.node);
    regenerateIds(clone);
    ref.list.splice(ref.index + 1, 0, clone);
    afterModelChange();
    return clone;
  }
  function wrapSelection(qid, containerType) {
    if (!isContainerType(containerType)) { return null; }
    var ref = findRef(qid);
    if (!ref) { return null; }
    if (ref.depth > MAX_DEPTH || subtreeMaxContainerDepth(ref.node, ref.depth + 1) > MAX_DEPTH) {
      showRefusal('Grouping here would exceed the max container depth of ' + MAX_DEPTH + '.');
      return null;
    }
    var wrapper = { type: containerType, question_id: newQuestionId(), children: [ref.node] };
    ref.list[ref.index] = wrapper;
    selectedQuestionId = wrapper.question_id;
    afterModelChange();
    return wrapper;
  }

  // --- live structural validation (REQUIRED_FIELDS projection; the server
  // validator stays authoritative on save) ------------------------------------
  // R4a E3-NEW-2/E2-NEW-10: extends the mirror beyond the original 4 classes
  // (unknown_component_type/container_depth_exceeded/missing_required_field/
  // duplicate_internal_field) to also cover duplicate_question_key,
  // conditional_unknown_field (both show-if and require-if),
  // container_answer_field_forbidden (defense-in-depth — the Advanced
  // internal_field input is already DISABLED for containers, this catches
  // legacy/pasted/imported content that control never wrote),
  // bind_type_mismatch/duplicate_bind (the Advanced raw-JSON surface can
  // hand-author an invalid one), and invalid_choice basics (label/value/
  // analytics_id). Still server-authoritative-only (NOT mirrored client-side):
  // answer_type_mismatch, non_curated_override_key/arbitrary_css_override/
  // invalid_override_value, choice_display_invalid, invalid_field_prop,
  // invalid_maps_prop, invalid_size_override, children_not_allowed,
  // container_prop_invalid, bound_node_carries_text, content_not_object/
  // components_not_array/node_not_object (shapes the island's own model can't
  // produce), and the 3 non-blocking WARNING codes (frame_scope_component,
  // duplicate_continue, maps_no_job — surfaced by their OWN dedicated banners
  // elsewhere, not this issues list).
  function computeIssues() {
    var issues = [];
    // Adversarial-review fix (fix-in-phase doctrine — fieldSeen predates
    // R4a): a plain {} seen-map INHERITS Object.prototype's own keys
    // ('valueOf'/'constructor'/'toString'/…) — a SINGLE node whose
    // internal_field/question_key/internal_field-as-known-field happens to
    // be one of those names would read back truthy before it was ever set,
    // producing a phantom duplicate/known-field hit. Object.create(null)
    // carries no prototype at all, so only keys THIS code actually sets are
    // ever truthy.
    var fieldSeen = Object.create(null);
    var keySeen = Object.create(null);
    var bindSeen = {};
    // Pass 1: the whole-tree known-field universe (internal_field /
    // question_key / question_id), SELF-INCLUSIVE — matches the server's
    // collectKnownFields (content-schema.ts), NOT internalFieldsOf()'s
    // self-excluded UI list (that one is for the rules dropdown only).
    var knownFields = Object.create(null);
    walkTree(state.content.components, 1, function (n) {
      if (trimStr(n.internal_field) !== '') { knownFields[n.internal_field] = true; }
      if (trimStr(n.question_key) !== '') { knownFields[n.question_key] = true; }
      if (n.question_id) { knownFields[n.question_id] = true; }
    });
    if (state.content.components.length === 0) {
      issues.push({ qid: null, message: 'Add at least one component' });
    }
    walkTree(state.content.components, 1, function (node, depth) {
      var meta = studioMeta.types[node.type];
      if (!meta) { issues.push({ qid: node.question_id, message: 'Unknown component type ' + node.type }); return; }
      // §7.4 relabel: issues speak operator words (label), never raw type ids.
      var label = typeLabel(node.type) + (node.internal_field ? ' (' + node.internal_field + ')' : '');
      var req = meta.required || {};
      if (meta.container && depth > MAX_DEPTH) {
        issues.push({ qid: node.question_id, message: label + ' exceeds the max container depth of ' + MAX_DEPTH });
      }
      if (req.internal_field && trimStr(node.internal_field) === '') {
        issues.push({ qid: node.question_id, message: label + ' needs an internal field' });
      }
      var f = trimStr(node.internal_field);
      if (f !== '') {
        if (fieldSeen[f]) { issues.push({ qid: node.question_id, message: 'Duplicate internal field: ' + f }); }
        fieldSeen[f] = true;
      }
      // duplicate_question_key mirror.
      var qk = trimStr(node.question_key);
      if (qk !== '') {
        if (keySeen[qk]) { issues.push({ qid: node.question_id, message: label + ' has a duplicate analytics label: ' + qk }); }
        keySeen[qk] = true;
      }
      // container_answer_field_forbidden mirror (E2-NEW-10 studio mirror):
      // containers carry no answer field.
      if (meta.container) {
        if (node.internal_field) { issues.push({ qid: node.question_id, message: label + ' is a layout container — it cannot have an internal field' }); }
        if (node.choices && node.choices.length > 0) { issues.push({ qid: node.question_id, message: label + ' is a layout container — it cannot have choices' }); }
        if (node.answer_type) { issues.push({ qid: node.question_id, message: label + ' is a layout container — it cannot have an answer type' }); }
      }
      // conditional_unknown_field mirror — the show-if condition reference
      // is server-mirrored (content-schema.ts validateConditional runs on
      // node.conditional). Adversarial-review ruling: props.requiredWhen is
      // NEVER validated server-side (validateConditional only runs for the
      // conditional field) — the require-if check below is HONEST about that:
      // an ADVISORY, worded and (were there severity styling on this list)
      // styled distinctly from the server-mirrored error above, not a
      // same-class duplicate claim. Kept because it catches a real
      // dangling-reference authoring bug the server will silently accept.
      if (node.conditional && node.conditional.when && !knownFields[node.conditional.when]) {
        issues.push({ qid: node.question_id, message: label + '’s show-if condition references an unknown field: ' + node.conditional.when });
      }
      if (node.props && node.props.requiredWhen && node.props.requiredWhen.when && !knownFields[node.props.requiredWhen.when]) {
        issues.push({ qid: node.question_id, message: 'Advisory: ' + label + '’s “require when” points at a field that no longer exists (' + node.props.requiredWhen.when + ') — the server accepts this, but the rule will never trigger.' });
      }
      // bind_type_mismatch / duplicate_bind mirror — the canonical headline/
      // subheadline binding is normally system-managed; the Advanced raw-JSON
      // surface can hand-author an invalid one (reuses bindNodeType, the
      // SAME bind<->type mapping the rest of the island uses).
      if (node.bind !== undefined) {
        if (node.bind !== 'section_headline' && node.bind !== 'section_subheadline') {
          issues.push({ qid: node.question_id, message: label + ' has an unrecognized bind marker: ' + node.bind });
        } else if (bindNodeType(node.bind) !== node.type) {
          issues.push({ qid: node.question_id, message: 'bind ‘' + node.bind + '’ is only legal on ' + bindNodeType(node.bind) });
        } else if (bindSeen[node.bind]) {
          issues.push({ qid: node.question_id, message: 'Duplicate bind: ' + node.bind });
        } else {
          bindSeen[node.bind] = true;
        }
      }
      if (req.choices && (!node.choices || node.choices.length === 0)) {
        issues.push({ qid: node.question_id, message: label + ' needs at least one choice' });
      }
      // invalid_choice basics mirror (label / value / analytics_id — the
      // fields REQUIRED unconditionally per content-schema.ts; the per-type
      // icon/imageMediaId variants stay server-only).
      if (node.choices && node.choices.length > 0) {
        var ci, choice, vt;
        for (ci = 0; ci < node.choices.length; ci++) {
          choice = node.choices[ci];
          if (!choice || typeof choice !== 'object') { issues.push({ qid: node.question_id, message: label + ' has a choice that is not valid' }); continue; }
          if (trimStr(choice.label) === '') { issues.push({ qid: node.question_id, message: label + ' has a choice missing its label' }); }
          vt = typeof choice.value;
          if (vt !== 'string' && vt !== 'number' && vt !== 'boolean') { issues.push({ qid: node.question_id, message: label + ' has a choice with an invalid value' }); }
          if (trimStr(choice.analytics_id) === '') { issues.push({ qid: node.question_id, message: label + ' has a choice missing its analytics id' }); }
        }
      }
      var i, k, props = node.props || {};
      var tp = req.text_props || [];
      for (i = 0; i < tp.length; i++) {
        k = tp[i];
        // §3.4/§5.2: a BOUND node's text IS the Section column — the required-
        // text rule is waived exactly like the server validator waives it.
        if (k === 'text' && node.bind !== undefined) { continue; }
        if (trimStr(props[k]) === '') { issues.push({ qid: node.question_id, message: label + ' needs its ' + k }); }
      }
      var np = req.numeric_props || [];
      for (i = 0; i < np.length; i++) {
        k = np[i];
        if (typeof props[k] !== 'number' || !isFinite(props[k])) { issues.push({ qid: node.question_id, message: label + ' needs a numeric ' + k }); }
      }
    });
    return issues;
  }
  function issueFocusHandler(qid) {
    return function () { if (qid) { selectComponent(qid); } };
  }
  function renderIssues() {
    var issues = computeIssues();
    var chip = document.querySelector('[data-studio-validation-chip]');
    if (chip) {
      chip.setAttribute('data-issue-count', String(issues.length));
      chip.textContent = issues.length === 0 ? 'No issues' : (issues.length === 1 ? '1 issue' : issues.length + ' issues');
    }
    var list = document.querySelector('[data-studio-validation-list]');
    if (!list) { return; }
    clearChildren(list);
    var i, li, btn;
    for (i = 0; i < issues.length; i++) {
      li = document.createElement('li');
      btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = issues[i].message;
      if (issues[i].qid) { btn.setAttribute('data-focus-qid', issues[i].qid); }
      btn.addEventListener('click', issueFocusHandler(issues[i].qid));
      li.appendChild(btn);
      list.appendChild(li);
    }
    if (issues.length === 0) {
      li = document.createElement('li');
      li.className = 'form-help';
      li.appendChild(document.createTextNode('No structural issues.'));
      list.appendChild(li);
    }
  }

  // §8.8 key-missing warning banner: visible ONLY when the tree carries a
  // Maps-enabled component AND no browser key is configured (data attribute
  // from the server). Key present or nothing Maps-enabled → hidden.
  function renderMapsBanner() {
    var el = document.querySelector('[data-studio-maps-banner]');
    if (!el) { return; }
    if (el.getAttribute('data-maps-key-configured') === 'true') { el.hidden = true; return; }
    var enabled = false;
    walkTree(state.content.components, 1, function (n) {
      if (nodeMapsEnabled(n)) { enabled = true; }
    });
    el.hidden = !enabled;
  }

  // --- §5.2 bind UI: hidden chips, palette disabling, the legacy link banner ---
  // "Hidden in this question unit · [Show]" — chip visible while the bound
  // node for its bind value is deleted from the unit (canonical text kept).
  function renderBoundChips() {
    var chips = document.querySelectorAll('[data-bound-chip]');
    var i, b;
    for (i = 0; i < chips.length; i++) {
      b = chips[i].getAttribute('data-bound-chip');
      chips[i].hidden = findBoundNode(b) !== null;
    }
  }
  // Palette "Question headline"/"Subheadline": insert bound nodes while none
  // exists, else disabled with the exact tooltip (§5.2).
  function updatePaletteBindItems() {
    var items = document.querySelectorAll('[data-bind-item]');
    var i, b, exists;
    for (i = 0; i < items.length; i++) {
      b = items[i].getAttribute('data-bind-item');
      exists = findBoundNode(b) !== null;
      items[i].setAttribute('data-bind-disabled', exists ? 'true' : 'false');
      items[i].setAttribute('aria-disabled', exists ? 'true' : 'false');
      if (exists) { items[i].setAttribute('title', 'This Section already shows its ' + bindNoun(b)); }
      else { items[i].removeAttribute('title'); }
    }
  }
  function bindBannerButton(label, handler) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-secondary';
    b.textContent = label;
    b.addEventListener('click', handler);
    return b;
  }
  function bindBannerLinkHandler(qid, bindValue, winnerText) {
    return function () { linkBoundNode(qid, bindValue, winnerText); };
  }
  // §5.2 legacy Sections: an UNBOUND QuestionHeadline/Subheadline while no
  // bound node exists gets the link banner — byte-equal text offers the
  // one-click link; differing text shows BOTH values and the operator picks
  // which wins. Load alone never mutates; the picked change lands in the
  // model (dirty) and persists on Save.
  function renderBindBanner() {
    var banner = document.querySelector('[data-bind-banner]');
    if (!banner) { return; }
    clearChildren(banner);
    var binds = ['section_headline', 'section_subheadline'];
    var shown = false;
    var i, bindValue, node, strip, canonical, nodeText, row, msg, val;
    for (i = 0; i < binds.length; i++) {
      bindValue = binds[i];
      if (findBoundNode(bindValue) !== null) { continue; }
      node = unboundCandidate(bindValue);
      if (node === null) { continue; }
      strip = stripInputFor(bindValue);
      canonical = strip ? strip.value : '';
      nodeText = (node.props && typeof node.props.text === 'string') ? node.props.text : '';
      row = document.createElement('div');
      row.className = 'studio-bind-banner-row';
      row.setAttribute('data-bind-banner-row', bindValue);
      msg = document.createElement('span');
      if (nodeText === canonical) {
        row.setAttribute('data-bind-banner-case', 'equal');
        msg.appendChild(document.createTextNode('This ' + bindNoun(bindValue) + ' matches the Section\\u2019s canonical text.'));
        row.appendChild(msg);
        row.appendChild(bindBannerButton('Link ' + bindNoun(bindValue) + ' to the Section\\u2019s canonical ' + bindNoun(bindValue), bindBannerLinkHandler(node.question_id, bindValue, null)));
      } else {
        row.setAttribute('data-bind-banner-case', 'differs');
        msg.appendChild(document.createTextNode('This ' + bindNoun(bindValue) + ' differs from the Section\\u2019s canonical text \\u2014 pick which wins:'));
        row.appendChild(msg);
        val = document.createElement('span');
        val.className = 'studio-bind-banner-value';
        val.setAttribute('data-bind-banner-canonical', '');
        val.appendChild(document.createTextNode('\\u201C' + canonical + '\\u201D'));
        row.appendChild(val);
        row.appendChild(bindBannerButton('Keep the Section ' + bindNoun(bindValue), bindBannerLinkHandler(node.question_id, bindValue, null)));
        val = document.createElement('span');
        val.className = 'studio-bind-banner-value';
        val.setAttribute('data-bind-banner-node', '');
        val.appendChild(document.createTextNode('\\u201C' + nodeText + '\\u201D'));
        row.appendChild(val);
        row.appendChild(bindBannerButton('Use this component\\u2019s text', bindBannerLinkHandler(node.question_id, bindValue, nodeText)));
      }
      banner.appendChild(row);
      shown = true;
    }
    banner.hidden = !shown;
  }

  function afterModelChange() {
    // m3 (adversarial re-review) extra robustness: ANY other model mutation
    // proactively tears down a still-registered width-drag (the "moved then
    // the mouseup got lost off-window" case, where the drag's OWN moved flag
    // is already true, so a later stray mouseup would otherwise still commit
    // a stale width). A no-op when this IS the drag's own afterModelChange
    // call — its finishUp already nulled activeWidthDragCleanup via
    // cleanupListeners() before reaching here. typeof-guarded (not a bare
    // reference): this function is sliced standalone into several unrelated
    // vitest probes that never declare activeWidthDragCleanup — a bare
    // reference would throw ReferenceError there, in every one of them, for
    // a concern entirely outside what they test.
    if (typeof activeWidthDragCleanup !== 'undefined' && activeWidthDragCleanup) { activeWidthDragCleanup(); }
    // R4a conductor addition (adversarial review, E3-NEW-7): a lingering
    // undo toast is STALE the moment any OTHER mutation happens — clicking
    // its Undo would revert the LATER change while still labeled for the
    // deleted element. Invalidate on every mutation, not just a timeout.
    // Same typeof-guard idiom as activeWidthDragCleanup above (this
    // function is sliced standalone into vitest probes that never declare
    // hideUndoToast).
    if (typeof hideUndoToast !== 'undefined') { hideUndoToast(); }
    markDirty();
    historyPush();
    clearRefusal();
    renderIssues();
    renderMapsBanner();
    renderBoundChips();
    updatePaletteBindItems();
    renderBindBanner();
    // 09 §9.4 "appears once overridden": the inheritance-source line, the
    // "Reset to inherited" affordance and the swatch repaint IMMEDIATELY on a
    // pick — same tick, never deferred to a re-selection.
    renderOverrideDecorations(selectedNode());
    updateCanvasToolbar();
    scheduleCanvasRender();
  }

  // --- R4a E3-NEW-7: canvas Delete undo toast ----------------------------------
  // Justification (against this island's own idioms): every OTHER mutation
  // here (move/duplicate/group/ungroup/wrap) commits immediately with the
  // 50-step undo history (historyPush/historyUndo, UNDO_LIMIT) as the SAFETY
  // NET — none of them gate on a blocking confirm(). A confirm() on Delete
  // alone would be the ONE inconsistent mutation in the whole toolbar, and
  // it interrupts flow for what is very often a correction (wrong component
  // picked, refining structure). A brief, dismissible toast with a real
  // Undo action (reusing the SAME history — no new persistence) matches the
  // established pattern and still gives the operator a way back.
  var undoToastTimer = null;
  function hideUndoToast() {
    var el = document.querySelector('[data-studio-undo-toast]');
    if (el && el.parentNode) { el.parentNode.removeChild(el); }
    if (undoToastTimer) { clearTimeout(undoToastTimer); undoToastTimer = null; }
  }
  function showUndoToast(label) {
    hideUndoToast();
    var el = document.createElement('div');
    el.className = 'studio-undo-toast';
    el.setAttribute('data-studio-undo-toast', '');
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.appendChild(document.createTextNode(label + ' deleted \\u2014 '));
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.appendChild(document.createTextNode('Undo'));
    btn.addEventListener('click', function () {
      historyUndo();
      hideUndoToast();
    });
    el.appendChild(btn);
    document.body.appendChild(el);
    undoToastTimer = setTimeout(hideUndoToast, 6000);
  }
  // The ONE call site both the toolbar Delete button and the Delete/
  // Backspace key handler now route through (removeNode/selectComponent
  // themselves stay unchanged pure model calls — this wrapper only adds the
  // DOM-side toast).
  function deleteSelectedWithUndo(qid) {
    var ref = findRef(qid);
    var label = ref && ref.node ? typeLabel(ref.node.type) : 'Element';
    removeNode(qid);
    selectComponent(null);
    showUndoToast(label);
  }

  // --- refusal + pending-insert notes -----------------------------------------
  function showRefusal(message) {
    var el = document.querySelector('[data-studio-drop-refusal]');
    if (!el) { return; }
    el.hidden = false;
    el.textContent = message;
  }
  function clearRefusal() {
    var el = document.querySelector('[data-studio-drop-refusal]');
    if (el) { el.hidden = true; el.textContent = ''; }
  }
  function updatePendingUi() {
    var note = document.querySelector('[data-studio-pending-note]');
    if (note) {
      note.hidden = !pendingInsert;
      note.textContent = pendingInsert ? 'Insertion point armed (' + pendingInsert.where + ' the selection) — pick a component from the library.' : '';
    }
    var btns = document.querySelectorAll('[data-studio-act="add-before"], [data-studio-act="add-after"]');
    var i, act;
    for (i = 0; i < btns.length; i++) {
      act = btns[i].getAttribute('data-studio-act') === 'add-before' ? 'before' : 'after';
      btns[i].setAttribute('aria-pressed', pendingInsert && pendingInsert.where === act ? 'true' : 'false');
    }
  }

  // --- canvas: server re-render (debounced) + selection overlay ---------------
  // DEV-66: the render region lives inside the canvas srcdoc iframe (a REAL
  // viewport — the design's mobile @media block can genuinely fire at 375).
  // The document persists across re-renders (only the mount's markup is
  // replaced), so the delegation bound once per LOADED document survives.
  function canvasFrameEl() { return document.getElementById('lg-studio-canvas-frame'); }
  function canvasFrameDoc() {
    var frame = canvasFrameEl();
    if (!frame) { return null; }
    try {
      if (frame.contentDocument) { return frame.contentDocument; }
      if (frame.contentWindow && frame.contentWindow.document) { return frame.contentWindow.document; }
    } catch (eDoc) { return null; }
    return null;
  }
  function canvasRegion() {
    var doc = canvasFrameDoc();
    if (!doc || !doc.getElementById) { return null; }
    return doc.getElementById('lg-studio-canvas-render');
  }
  // §6.1.4: the frame element IS the canvas viewport — Desktop 1280 /
  // Mobile 375 (the ui-quotes setCanvasDoc idiom).
  function updateCanvasFrameViewport() {
    var frame = canvasFrameEl();
    if (!frame) { return; }
    frame.style.width = canvasViewport === 'mobile' ? '375px' : '1280px';
    frame.setAttribute('data-canvas-frame-viewport', canvasViewport);
  }
  // The iframe cannot auto-size to its content — track the document height
  // after every render/decoration pass (320px floor = the surface min-height).
  function updateCanvasFrameHeight() {
    var frame = canvasFrameEl();
    var doc = canvasFrameDoc();
    if (!frame || !doc || !doc.body) { return; }
    var h = doc.body.scrollHeight || 0;
    frame.style.height = (h > 320 ? h : 320) + 'px';
  }
  // In-frame images finish loading AFTER the render pass measured the
  // document, so the pass-time height misses their laid-out size. One
  // DELEGATED listener per loaded frame document (bound in
  // bindCanvasFrameDoc, the same lifetime as the surface delegation):
  // img 'load' events do not bubble, so it rides the CAPTURE phase.
  function onFrameDocLoadCapture(ev) {
    var t = ev ? ev.target : null;
    if (t && t.tagName && String(t.tagName).toUpperCase() === 'IMG') {
      updateCanvasFrameHeight();
    }
  }
  var canvasTimer = null;
  function scheduleCanvasRender() {
    if (canvasTimer) { clearTimeout(canvasTimer); }
    canvasTimer = setTimeout(function () {
      canvasTimer = null;
      // §6.2: never stomp an in-progress inline edit — re-check after commit.
      if (inlineEditing) { scheduleCanvasRender(); return; }
      renderCanvasNow();
    }, 300);
  }
  function renderCanvasNow() {
    var region = canvasRegion();
    // the srcdoc document may not have loaded yet — retry on the debounce
    // cadence; the load binding (bindCanvasFrameDoc) restores decoration.
    if (!region) { scheduleCanvasRender(); return; }
    // §5.2 one store, two views: the strip values ride every canvas render so
    // BOUND QuestionHeadline/Subheadline nodes show the live canonical text
    // (the preview handler threads body.headline/body.subheadline into
    // sectionCtx). Typing in the strip schedules this re-render.
    var headEl = document.getElementById('lg-section-headline');
    var subEl = document.getElementById('lg-section-subheadline');
    // §6.1.4: the canvas viewport is SERVER-rendered (viewport param); §9.5:
    // the Section overrides ride as layer 4 so the canvas shows them live.
    var canvasBody = {
      content_json: JSON.stringify(state.content),
      viewport: canvasViewport,
      headline: headEl ? headEl.value : '',
      subheadline: subEl ? subEl.value : ''
    };
    if (state.design_overrides) { canvasBody.design_overrides = state.design_overrides; }
    fetch('/api/admin/leadgen/sections/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(canvasBody)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.preview) { return; }
      region.innerHTML = '<style>' + res.body.preview.css + '</style>' + (res.body.preview.html || res.body.preview.desktop || '');
      applyCanvasDecoration();
      updateCanvasEmpty();
    }).catch(function () {});
  }
  function updateCanvasEmpty() {
    var empty = document.querySelector('[data-studio-canvas-empty]');
    if (empty) { empty.hidden = state.content.components.length > 0; }
  }
  function withoutClasses(cls, names) {
    var parts = String(cls || '').split(' ');
    var out = [], i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] !== '' && names.indexOf(parts[i]) === -1) { out.push(parts[i]); }
    }
    return out.join(' ');
  }
  // §5.4: session-local "Keep (legacy)" acknowledgements — badge stays hidden
  // for these nodes until reload (Keep = no model change by contract).
  var keptLegacyFrameNodes = {};
  // §5.4 amber badge for a legacy PAGE-FRAME element found in content. Wave 2:
  // the Move action is LIVE — used-by-one funnel → explicit confirm naming
  // the funnel → real PUT /funnels/:id/frame + node removal persisted on the
  // same action; used-by-many → funnel picker; the C2 consequence line stays.
  function buildFrameBadge(qid, type) {
    // NOTE: buildFrameBadge is sliced-and-run in ISOLATION by the studio-ui
    // vm-probe (it's a leaf), so it must not reference the island-scoped frameCreate()
    // helper (undefined in an isolated slice). It keeps document.createElement
    // — the badge is a SIBLING insert whose adoption into the frame is harmless;
    // the register's S1-10 scope is the selection-chrome createElement calls.
    var badge = document.createElement('div');
    badge.className = 'studio-frame-badge';
    badge.setAttribute('data-frame-badge', qid);
    var text = document.createElement('span');
    text.appendChild(document.createTextNode('Part of the funnel layout \\u2014 shared across this funnel \\u00B7'));
    badge.appendChild(text);
    var move = document.createElement('button');
    move.type = 'button';
    move.className = 'btn btn-sm btn-outline';
    move.setAttribute('data-frame-move', qid);
    move.title = 'Move this ' + typeLabel(type) + ' into the funnel layout (edited in the Quote Builder).';
    move.appendChild(document.createTextNode('Move to funnel layout'));
    badge.appendChild(move);
    var keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn btn-sm btn-outline';
    keep.setAttribute('data-frame-keep', qid);
    keep.appendChild(document.createTextNode('Keep as-is'));
    badge.appendChild(keep);
    // C2 consequence (§5.4): the badge NAMES the activation block.
    var note = document.createElement('span');
    note.className = 'studio-frame-badge-note';
    note.appendChild(document.createTextNode('While a funnel using this Section has a configured funnel layout, activation blocks on this element unless that funnel\\u2019s Advanced override allows it.'));
    badge.appendChild(note);
    return badge;
  }
  // §6.2 canvas choice decoration: per-choice selection highlight, the per-
  // choice ✕, the "+ Add choice" ghost tile at the grid end, choice drag
  // handles and the selected-CardPanel resize handle. Rebuilt per pass like
  // the maps chips (the region is server HTML).
  function decorateChoiceCards(region) {
    var cards = region.querySelectorAll('[data-lg-choice]');
    var i, card, host, qid, x;
    for (i = 0; i < cards.length; i++) {
      card = cards[i];
      host = card.closest ? card.closest('[data-question-id]') : null;
      if (!host) { continue; }
      qid = host.getAttribute('data-question-id');
      if (typeMeta(host.getAttribute('data-component-type')).choice !== true) { continue; }
      card.setAttribute('draggable', 'true');
      if (qid === selectedQuestionId && selectedChoiceValue !== null && card.getAttribute('data-lg-choice') === String(selectedChoiceValue)) {
        card.className = card.className + ' studio-choice-selected';
      }
      x = frameCreate('button');
      x.type = 'button';
      x.className = 'studio-choice-x';
      x.setAttribute('data-choice-x', card.getAttribute('data-lg-choice'));
      x.setAttribute('data-choice-x-qid', qid);
      x.setAttribute('aria-label', 'Remove choice');
      x.appendChild(document.createTextNode('\\u00D7'));
      if (card.parentNode) { card.parentNode.insertBefore(x, card.nextSibling); }
    }
    var nodes = region.querySelectorAll('[data-question-id]');
    var ghost, handle, type;
    for (i = 0; i < nodes.length; i++) {
      qid = nodes[i].getAttribute('data-question-id');
      type = nodes[i].getAttribute('data-component-type');
      if (typeMeta(type).choice === true) {
        ghost = frameCreate('button');
        ghost.type = 'button';
        ghost.className = 'lg-card studio-choice-ghost';
        ghost.setAttribute('data-choice-ghost', qid);
        ghost.appendChild(document.createTextNode('+ Add choice'));
        nodes[i].appendChild(ghost);
      }
      // §6.2: resize handle on the SELECTED CardPanel — snaps to width presets.
      if (type === 'CardPanel' && qid === selectedQuestionId) {
        nodes[i].style.position = 'relative';
        handle = frameCreate('span');
        handle.className = 'studio-resize-handle';
        handle.setAttribute('data-resize-handle', qid);
        handle.title = 'Drag to resize \\u2014 snaps to the width presets (s / m / l / full)';
        nodes[i].appendChild(handle);
      }
    }
  }
  // §12.3 canvas mapping OVERLAY (toggle in the preview drawer): every answer
  // component gets a chip — mapped (n Offers) or a red required-missing —
  // clicking one opens the inspector Mapping tab scoped to that component.
  // Rebuilt per decoration pass like every other canvas chip.
  var mappingOverlayOn = false;
  function decorateMappingOverlay(region) {
    if (!mappingOverlayOn) { return; }
    var nodes = region.querySelectorAll('[data-question-id]');
    var i, qid, ref, info, chip;
    for (i = 0; i < nodes.length; i++) {
      qid = nodes[i].getAttribute('data-question-id');
      ref = findRef(qid);
      if (!ref || !ref.node || !typeMeta(ref.node.type).produces || trimStr(ref.node.internal_field) === '') { continue; }
      info = overlayChipInfo(ref.node.internal_field);
      chip = frameCreate('button');
      chip.type = 'button';
      chip.className = 'studio-mapoverlay-chip';
      chip.setAttribute('data-mapping-overlay-chip', qid);
      chip.setAttribute('data-overlay-state', info.required_missing ? 'required-missing' : 'mapped');
      chip.setAttribute('data-overlay-count', String(info.count));
      chip.title = 'Open the Offers tab for this component';
      chip.appendChild(document.createTextNode(info.required_missing ? 'Required \\u2014 missing' : 'Mapped \\u00B7 ' + info.count + ' Offer' + (info.count === 1 ? '' : 's')));
      chip.addEventListener('click', function () {
        selectComponent(this.getAttribute('data-mapping-overlay-chip'));
        setInspectorTab('offers');
      });
      if (nodes[i].parentNode) { nodes[i].parentNode.insertBefore(chip, nodes[i]); }
    }
  }
  // --- §6.2/§7 selection chrome + width-drag (golden 307-358) ------------------
  // Measurement formula (§7.1.3, binding): stored value = the drag's measured
  // content-box width in px, snapped to a 4px grid, clamped to [200,600] (the
  // Appendix B unit-column width). The golden hardcodes its demo "384"; this
  // computes the true value (§0 fidelity-vs-function).
  var WIDTH_PX_MIN = 200, WIDTH_PX_MAX = 600, WIDTH_PX_GRID = 4;
  function snapWidthCustomPx(px) {
    var snapped = Math.round(px / WIDTH_PX_GRID) * WIDTH_PX_GRID;
    return Math.max(WIDTH_PX_MIN, Math.min(WIDTH_PX_MAX, snapped));
  }
  function currentCustomWidthPx(node) {
    var w = node && node.design_overrides && node.design_overrides.size && node.design_overrides.size.width;
    if (w && typeof w === 'object' && typeof w.custom_px === 'number') { return w.custom_px; }
    return null;
  }
  // R2 S1-4 HEIGHT drag range (binding, read from content-schema.ts): unlike
  // WIDTH's [200,600] Appendix-B unit column, height custom_px is validated —
  // BOTH at save time (validateSizeAxis via validateSizeOverride) AND at render
  // (resolveFieldSize's defensive clamp) — to [4,600] snapped to a 4px grid.
  // The floor is 4 (grid-native), NOT 200: the contract's own §7.2 worked
  // example stores a height custom_px of 56, below the width floor, so the
  // width floor would reject the contract's example (content-schema.ts
  // SIZE_HEIGHT_CUSTOM_PX_MIN/MAX + SIZE_GRID_PX, lines documenting this).
  var HEIGHT_PX_MIN = 4, HEIGHT_PX_MAX = 600, HEIGHT_PX_GRID = 4;
  function snapHeightCustomPx(px) {
    var snapped = Math.round(px / HEIGHT_PX_GRID) * HEIGHT_PX_GRID;
    return Math.max(HEIGHT_PX_MIN, Math.min(HEIGHT_PX_MAX, snapped));
  }
  function currentCustomHeightPx(node) {
    var h = node && node.design_overrides && node.design_overrides.size && node.design_overrides.size.height;
    if (h && typeof h === 'object' && typeof h.custom_px === 'number') { return h.custom_px; }
    return null;
  }
  // R2 S1-10: decoration nodes are INSERTED into the canvas iframe document, so
  // they must be CREATED by that same document — createElement in the parent
  // doc then inserting cross-document is an implicit adoption (works today, but
  // fragile). frameCreate() creates through the frame doc when reachable, falling back to
  // the parent document only if the frame is not yet loaded (in which case the
  // element is adopted on insert exactly as before — never worse).
  function frameCreate(tag) {
    var doc = canvasFrameDoc();
    return (doc && doc.createElement) ? doc.createElement(tag) : document.createElement(tag);
  }
  // R2 S1-5/S1-6: the field types whose [data-question-id] node is a BARE
  // <input> (presets.ts renderTextInput). For these, a native mouse drag on the
  // field body arms text-selection, not a move — so the input is NOT the native
  // drag source (draggable stays off); onFieldMoveMouseDown is instead attached
  // DIRECTLY to the input element (decorateFieldSelection below) so a body drag
  // reorders it. Currency/Address are DIV hosts (.lg-currency/.lg-address) so
  // they reorder via ordinary native DnD.
  var BARE_INPUT_FIELD_TYPES = { FreeTextQuestion: 1, NumberInputQuestion: 1, EmailInputQuestion: 1, PhoneInputQuestion: 1, ZIPInputQuestion: 1, DateQuestion: 1 };
  function isBareInputFieldType(type) { return BARE_INPUT_FIELD_TYPES[type] === 1; }
  // R2 adversarial-review MAJOR fix #1: the SIZE-CONSUMING type predicate.
  // Membership = the EXACT set of types whose presets.ts renderer applies
  // design_overrides.size to computed CSS — derived by reading presets.ts's
  // consumption call sites (brace-bounded per function body), never assumed:
  //   - the text-input family routes through renderTextInput -> fieldStyleAttr
  //     -> sizeStyleEntries (presets.ts ~1403-1404): FreeTextQuestion,
  //     NumberInputQuestion, EmailInputQuestion, PhoneInputQuestion,
  //     DateQuestion, ZIPInputQuestion (their renderFreeTextQuestion/
  //     renderNumberInputQuestion/renderEmailInputQuestion/
  //     renderPhoneInputQuestion/renderDateQuestion/renderZIPInputQuestion all
  //     call renderTextInput).
  //   - CurrencyInputQuestion and AddressAutocompleteQuestion apply
  //     fieldSizeStyle (-> sizeStyleEntries) directly to their OUTER
  //     .lg-currency / .lg-address wrapper — the ONLY other two call sites
  //     of fieldSizeStyle/fieldStyleAttr/sizeStyleEntries in the whole render
  //     tree (confirmed exhaustively — no other file references them).
  // Every OTHER field-chrome type (ButtonAnswerGroup/Dropdown/Range/
  // ImageBlock/etc. — register S2-1, assigned to R3 "WIRE renderers + gate")
  // does NOT consume size yet: a resize drag on one would write a phantom
  // design_overrides.size.custom_px that persists to D1 (the server validator
  // accepts it for any node) with NO visible canvas change — the operator's
  // original U6/P6 complaint through a new door (R2 adversarial review finding
  // #1). PINNED by a vitest set-equality test (test/leadgen-r2-canvas.test.ts)
  // against an INDEPENDENT derivation from presets.ts source, so R3 widening
  // presets.ts consumption fails that test until this list widens in lockstep.
  // v3.1 R3 §7/§8.5b (register S2-1/E1-C3/E2-NEW-7): the choice/button/card/
  // dropdown renderers now CONSUME design_overrides.size/.corners/.border_color
  // (presets.ts), so they join the size-consuming set in LOCKSTEP with the
  // presets.ts widening — the set-equality pin (test/leadgen-r2-canvas.test.ts)
  // re-derives this set from presets.ts SOURCE and fails if the two drift.
  var SIZE_CONSUMING_TYPES = { FreeTextQuestion: 1, NumberInputQuestion: 1, EmailInputQuestion: 1, PhoneInputQuestion: 1, DateQuestion: 1, ZIPInputQuestion: 1, CurrencyInputQuestion: 1, AddressAutocompleteQuestion: 1, ButtonAnswerGroup: 1, TwoButtonYesNo: 1, IconCardAnswerGrid: 1, ImageCardAnswerGrid: 1, MultiChoiceCardGroup: 1, DropdownQuestion: 1, SearchableDropdownQuestion: 1, OtherGroupSelector: 1 };
  function isSizeConsumingType(type) { return SIZE_CONSUMING_TYPES[type] === 1; }
  // v3.1 R3 E1-NEW-6: the toolbar Placeholder quick-input is dead for these 5
  // types — their renderers never read props.placeholder (the range family are
  // sliders; TwoButtonYesNo is fixed Yes/No; NameFieldsGroup has its own
  // firstLabel/lastLabel). Gated OFF so the toolbar never advertises a no-op.
  var PLACEHOLDER_INERT_TYPES = { RangeQuestion: 1, CurrencyRangeQuestion: 1, NumberRangeQuestion: 1, TwoButtonYesNo: 1, NameFieldsGroup: 1 };
  // §6.2 selection-chrome "kind": which of the golden's 3 variants applies.
  // Only 'field' gets the 8 handles — golden's headline/continue selections
  // show ONLY an outline + name tag (contract: "corner/vertical handles are
  // presentation FOR THIS FIELD TYPE"). Containers keep their PRE-EXISTING
  // .studio-resize-handle mechanism untouched — this is additive, not a
  // replacement, for the 3 golden-specified selection kinds.
  function selectionChromeKind(node) {
    if (!node) { return null; }
    if (node.bind === 'section_headline' || node.bind === 'section_subheadline' || node.type === 'QuestionHeadline' || node.type === 'Subheadline') { return 'headline'; }
    if (node.type === 'ContinueButton' || node.type === 'AutoAdvanceButton') { return 'continue'; }
    if (isContainerType(node.type)) { return null; }
    return 'field';
  }
  function clearSelectionChrome(region) {
    var chrome = region.querySelectorAll('[data-selection-chrome]');
    var i;
    for (i = 0; i < chrome.length; i++) { if (chrome[i].parentNode) { chrome[i].parentNode.removeChild(chrome[i]); } }
    // Unwrap any prior selection-wrap (moves its child back to its original
    // slot, then removes the now-empty wrapper) — the region is REBUILT from
    // server HTML on every content re-render, but a pure selection change
    // (selectComponent without a model mutation) does NOT re-fetch, so stale
    // wraps from a PREVIOUS selection must be cleaned before the next one.
    var wraps = region.querySelectorAll('[data-selection-wrap]');
    var w, ww;
    for (w = 0; w < wraps.length; w++) {
      ww = wraps[w];
      if (ww.parentNode) {
        while (ww.firstChild) { ww.parentNode.insertBefore(ww.firstChild, ww); }
        ww.parentNode.removeChild(ww);
      }
    }
  }
  function ensureSelectionWrap(el) {
    var wrap = frameCreate('span');
    wrap.setAttribute('data-selection-wrap', '1');
    wrap.style.cssText = 'position:relative;display:inline-block;width:100%;vertical-align:top';
    if (el.parentNode) { el.parentNode.insertBefore(wrap, el); }
    wrap.appendChild(el);
    return wrap;
  }
  // m3(a) (adversarial review): if a drag's mouseup is never delivered (the
  // pointer released outside the browser window entirely), NEITHER onUpInner
  // nor onUpOuter fires, so their listeners stayed attached forever — a
  // LATER, wholly unrelated mouseup elsewhere on the page would then run
  // THIS gesture's finishUp with its stale startX/startWidth/qid, writing a
  // bogus custom_px and marking the section dirty. One shared, module-level
  // reference to the current drag's cleanup: a NEW width-drag mousedown
  // tears down any still-attached PRIOR pair before starting its own, so at
  // most one listener pair ever exists — self-healing even when the true end
  // of a gesture is never observed. The per-gesture dragActive flag is a
  // second, independent guard (finishUp is a no-op after its own cleanup
  // already ran).
  var activeWidthDragCleanup = null;
  // R2 S1-3/S1-4: generalized from the E/W-only width drag to ALL 8 handles
  // (name kept as onWidthHandleMouseDown — it is the OTHER writer of
  // design_overrides.size that selectComponent/afterModelChange cross-reference,
  // and the studio-ui vm-probe slices it by this name). A handle declares which
  // axis/axes it drives via data-fr-wside ('left'|'right'|'') and data-fr-hside
  // ('top'|'bottom'|''): the two mid E/W handles set only wside, the two mid N/S
  // only hside, the four CORNERS BOTH. Width snaps/clamps to [200,600]; height to
  // [4,600] (snapHeightCustomPx — the schema's distinct height range). The
  // legacy data-width-handle/data-handle-side attributes are still READ as a
  // fallback so the original width-only fixtures keep exercising this path. Every
  // m3 lost-mouseup/stale-gesture guard below is preserved verbatim.
  function onWidthHandleMouseDown(ev) {
    var handle = ev.target && ev.target.closest ? (ev.target.closest('[data-field-resize-handle]') || ev.target.closest('[data-width-handle]')) : null;
    if (!handle) { return; }
    ev.preventDefault();
    if (ev.stopPropagation) { ev.stopPropagation(); }
    if (activeWidthDragCleanup) { activeWidthDragCleanup(); }
    var qid = handle.getAttribute('data-field-resize-handle') || handle.getAttribute('data-width-handle');
    var wSide = handle.getAttribute('data-fr-wside') || handle.getAttribute('data-handle-side') || '';
    var hSide = handle.getAttribute('data-fr-hside') || '';
    var wrap = handle.parentNode;
    var target = wrap ? wrap.querySelector('[data-question-id="' + qid + '"]') : null;
    // §7.1.3: applyCanvasDecoration already keeps this field NON-draggable
    // while its width handles are shown (native drag-candidate arming reads
    // the attribute at mousedown hit-test time, before any JS runs, so
    // toggling it here would be too late) — this restores the ordinary
    // container/canvas drag-reorder source the instant the gesture ends,
    // rather than waiting for the next debounced re-render.
    var startRect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
    var startWidth = startRect ? startRect.width : 0;
    var startHeight = startRect ? startRect.height : 0;
    var startX = ev.clientX;
    var startY = ev.clientY;
    var innerDoc = canvasFrameDoc();
    var startedInFrame = !!(innerDoc && handle.ownerDocument === innerDoc);
    var dragActive = true;
    // m3 (adversarial re-review): dragActive alone only guards against a
    // SECOND width-drag's mousedown reusing this same closure — it does
    // NOTHING for the reported scenario (grab a handle, release the pointer
    // off-window so this mouseup is never delivered, then click ANYWHERE
    // else on the page). That later, wholly unrelated mouseup still finds
    // dragActive===true (nothing else ever sets it false) and finishUp
    // still runs, writing a bogus custom_px from the click's position and
    // marking the section dirty. The moved flag below requires an ACTUAL
    // mousemove between this mousedown and whichever mouseup finishUp
    // responds to — absent one, finishUp only cleans up (no write, no
    // afterModelChange). This also retires the "a plain click on a handle
    // re-snaps custom_px to the current width" quirk (a click delivers
    // mousedown+mouseup with no intervening move either).
    var moved = false;
    function cleanupListeners() {
      if (innerDoc && innerDoc.removeEventListener) {
        innerDoc.removeEventListener('mouseup', onUpInner);
        innerDoc.removeEventListener('mousemove', onMoveInner);
        innerDoc.removeEventListener('mousedown', onOtherMouseDown, true);
      }
      document.removeEventListener('mouseup', onUpOuter);
      document.removeEventListener('mousemove', onMoveOuter);
      document.removeEventListener('mousedown', onOtherMouseDown, true);
      if (activeWidthDragCleanup === cleanupListeners) { activeWidthDragCleanup = null; }
    }
    function finishUp(upEv, viaParent) {
      if (!dragActive) { return; }
      dragActive = false;
      cleanupListeners();
      if (target && target.setAttribute) { target.setAttribute('draggable', 'true'); }
      if (!moved) { return; }
      var frame = canvasFrameEl();
      var frameLeft = 0, frameTop = 0;
      if (startedInFrame && viaParent && frame && frame.getBoundingClientRect) {
        var fr = frame.getBoundingClientRect();
        frameLeft = fr.left;
        frameTop = fr.top;
      }
      var ref = findRef(qid);
      if (!ref) { return; }
      if (!ref.node.design_overrides) { ref.node.design_overrides = {}; }
      if (!ref.node.design_overrides.size) { ref.node.design_overrides.size = {}; }
      if (wSide) {
        var deltaX = (upEv.clientX - frameLeft) - startX;
        var rawWidth = wSide === 'left' ? (startWidth - deltaX) : (startWidth + deltaX);
        var clamped = snapWidthCustomPx(rawWidth);
        ref.node.design_overrides.size.width = { custom_px: clamped };
      }
      if (hSide) {
        var deltaY = (upEv.clientY - frameTop) - startY;
        var rawHeight = hSide === 'top' ? (startHeight - deltaY) : (startHeight + deltaY);
        var clampedH = snapHeightCustomPx(rawHeight);
        ref.node.design_overrides.size.height = { custom_px: clampedH };
      }
      // R2 S1-4: refresh the Style-tab size controls so the Custom chip + Reset
      // (width AND height) reflect the drag LIVE — afterModelChange re-renders
      // the canvas/toolbar but never repopulates the inspector (setWidthPreset
      // calls populateSizeControls itself; the drag path used to skip it, so a
      // dragged custom_px never lit its chip until the next re-selection).
      // typeof-guarded (same idiom as activeWidthDragCleanup below): this handler
      // is sliced STANDALONE into vitest probes that never declare
      // populateSizeControls — a bare reference would ReferenceError there.
      if (typeof populateSizeControls === 'function') { populateSizeControls(ref.node); }
      afterModelChange();
    }
    function onUpInner(upEv) { finishUp(upEv, false); }
    function onUpOuter(upEv) { finishUp(upEv, true); }
    function onMoveInner() { moved = true; }
    function onMoveOuter() { moved = true; }
    // Scenario D (adversarial re-review): tearing down on the NEXT
    // selectComponent/afterModelChange fires too late for "click something
    // that selects nothing" (a library tile, top-bar chrome) — the browser
    // delivers mousedown, then mouseup, then click, in that order, so by the
    // time such a click's own selectComponent/afterModelChange could run, a
    // STALE (moved already true, terminal mouseup lost off-window) drag's
    // OWN mouseup listener has ALREADY fired on that interceding mouseup and
    // committed a bogus width. mousedown always precedes mouseup, so the
    // only airtight point left is the very next mousedown, anywhere,
    // BEFORE it can bubble to whatever handler that interaction has. Skips
    // handle-targeted mousedowns: a fresh onResizeHandleMouseDown already
    // tears down any prior drag itself (this function's own top) and then
    // re-arms activeWidthDragCleanup for its OWN gesture — this listener
    // must never immediately undo that brand new registration. Capture
    // phase so no other handler's stopPropagation can hide the mousedown
    // from this listener first.
    function onOtherMouseDown(dEv) {
      var onHandle = dEv.target && dEv.target.closest ? dEv.target.closest('[data-field-resize-handle]') : null;
      if (onHandle) { return; }
      if (activeWidthDragCleanup) { activeWidthDragCleanup(); }
    }
    activeWidthDragCleanup = cleanupListeners;
    if (innerDoc && innerDoc.addEventListener) {
      innerDoc.addEventListener('mousedown', onOtherMouseDown, true);
      innerDoc.addEventListener('mouseup', onUpInner);
      innerDoc.addEventListener('mousemove', onMoveInner);
    }
    document.addEventListener('mousedown', onOtherMouseDown, true);
    document.addEventListener('mouseup', onUpOuter);
    document.addEventListener('mousemove', onMoveOuter);
  }
  // R2 S1-5/S1-6: MOVE the selected field by dragging its BODY with a real
  // mouse. The text-input family's [data-question-id] node is a bare <input>
  // (presets.ts renderTextInput) — a native HTML5 drag started on it arms
  // caret/text-selection instead of dragstart (Currency/Address escape this via
  // their outer-div host, so containers/choice cards keep their native reorder).
  // So for a bare-input field the measured selection OUTLINE doubles as the drag
  // surface (pointer-events:auto, data-drag-qid) and runs a MOUSE-event reorder
  // gesture — the SAME primitive class the resize handles use (which a real
  // page.mouse CAN drive into the srcdoc canvas, unlike native HTML5 DnD).
  // mousedown -> track the pointer (via elementFromPoint in the frame doc) ->
  // on mouseup drop before/after/into the node under the release point.
  var activeFieldMoveCleanup = null;
  function onFieldMoveMouseDown(ev) {
    // R7 U11a: the ONE canvas move gesture for EVERY node type. Delegated on
    // the canvas surface (bindCanvasSurface) — a pointer press+drag on any
    // node's BODY reorders it (before/into/after via elementFromPoint, the
    // SAME semantics onCanvasDragOver computed). Native HTML5 DnD is retired
    // for canvas moves (it is unobservable under Chrome automation and failed
    // for the operator); this mouse-event path a real page.mouse can drive.
    // preventDefault stops caret/text-selection so a body drag reorders. SKIP
    // the affordances that own their own mousedown/click/drag so this never
    // hijacks them: selection chrome (a drag on a resize handle must RESIZE —
    // the R2 guard), intra-group choice cards (their own reorder — §6.2's
    // OWN pre-existing, load-bearing click semantics: onCanvasClick routes a
    // click on a choice card to selectChoice(), never the group — so a
    // choice-bearing group's BODY is entirely claimed by its children and can
    // never be this gesture's grab surface; see startFieldMove's outline-armed
    // sibling path below for how those groups move instead), container resize
    // handles, inline editing (caret placement), and the badge/picker click
    // affordances onCanvasClick owns.
    if (inlineEditing) { return; }
    var t = ev.target;
    if (!t || !t.closest) { return; }
    if (t.closest('[data-selection-chrome],[data-lg-choice],[data-resize-handle],[data-field-resize-handle],[data-width-handle],[contenteditable="true"],[data-frame-keep],[data-frame-move],[data-choice-x],[data-choice-ghost],[data-funnel-picker]')) { return; }
    var surface = t.closest('[data-question-id]');
    if (!surface) { return; }
    startFieldMove(surface.getAttribute('data-question-id'), ev);
  }
  // The CORE move-arming logic, extracted from onFieldMoveMouseDown so a
  // SECOND surface can start the SAME gesture for a qid it already knows: a
  // CHOICE-BEARING group's body is entirely covered by its data-lg-choice
  // children (excluded above, on purpose — §6.2 choice-card click/native-DnD
  // reorder must keep winning there), so it has no "body" pixel left to grab.
  // decorateFieldSelection arms this DIRECTLY on that group's own MEASURED
  // OUTLINE instead (pointer-events:auto, mousedown -> startFieldMove(qid,
  // ev)) — the exact same "outline doubles as the drag surface" precedent
  // S1-5/S1-6 established for bare-input fields (whose OWN element is an
  // <input> and so is also not its own grab surface), generalized to the
  // OTHER type-class whose body is likewise claimed by something else.
  function startFieldMove(qid, ev) {
    ev.preventDefault();
    if (ev.stopPropagation) { ev.stopPropagation(); }
    if (activeFieldMoveCleanup) { activeFieldMoveCleanup(); }
    var startX = ev.clientX, startY = ev.clientY;
    var innerDoc = canvasFrameDoc();
    var moved = false;
    var dragActive = true;
    function cleanup() {
      if (innerDoc && innerDoc.removeEventListener) {
        innerDoc.removeEventListener('mouseup', onUpInner);
        innerDoc.removeEventListener('mousemove', onMoveInner);
      }
      document.removeEventListener('mouseup', onUpOuter);
      document.removeEventListener('mousemove', onMoveOuter);
      if (activeFieldMoveCleanup === cleanup) { activeFieldMoveCleanup = null; }
      clearDropClasses();
    }
    function trackAt(clientX, clientY, viaParent) {
      if (Math.abs(clientX - startX) < 4 && Math.abs(clientY - startY) < 4) { return; }
      moved = true;
      var doc = canvasFrameDoc();
      if (!doc || !doc.elementFromPoint) { return; }
      var fx = clientX, fy = clientY;
      var frame = canvasFrameEl();
      if (viaParent && frame && frame.getBoundingClientRect) {
        var fr = frame.getBoundingClientRect();
        fx = clientX - fr.left;
        fy = clientY - fr.top;
      }
      clearDropClasses();
      dropHint = null;
      var over = doc.elementFromPoint(fx, fy);
      var host = over && over.closest ? over.closest('[data-question-id]') : null;
      if (!host || host.getAttribute('data-question-id') === qid) {
        // R7 U11a fix-cycle parity restore (conductor-ruled, post-SHIP MINOR
        // finding): the retired native-DnD move path's else-branch moved a
        // node released over EMPTY canvas space to the ROOT END
        // (moveNodeTo(payload,null,null)) — mirrors onCanvasDragOver's OWN
        // identical {qid:null,mode:'append'} fallback for the still-live
        // palette-tile-insert gesture ('add:' drag, same file, canvasOwns
        // guard). The local "over" value is non-null ONLY when (fx,fy) is
        // inside the canvas iframe's OWN rendered viewport —
        // doc.elementFromPoint's documented contract returns null for a
        // point outside that document's viewport — so this branch fires for
        // a genuine blank-canvas-space hover, never for a point outside the
        // canvas entirely (that leaves dropHint null, exactly as before this
        // fix — finishUp's own "no hint" guard still cancels, so an
        // off-canvas release is unaffected).
        // Hovering the DRAGGED NODE ITSELF (host resolves to its own qid) is
        // excluded on purpose — that is unchanged pre-fix behavior, not part
        // of this parity restore.
        if (over && !host) { dropHint = { qid: null, mode: 'append' }; }
        return;
      }
      var hqid = host.getAttribute('data-question-id');
      var type = host.getAttribute('data-component-type');
      var rect = host.getBoundingClientRect();
      var y = fy - rect.top;
      if (isContainerType(type) && y > rect.height * 0.25 && y < rect.height * 0.75) {
        dropHint = { qid: hqid, mode: 'into' };
        host.className = withoutClasses(host.className, DROP_CLASSES) + ' studio-drop-into';
      } else if (y < rect.height / 2) {
        dropHint = { qid: hqid, mode: 'before' };
        host.className = withoutClasses(host.className, DROP_CLASSES) + ' studio-drop-before';
      } else {
        dropHint = { qid: hqid, mode: 'after' };
        host.className = withoutClasses(host.className, DROP_CLASSES) + ' studio-drop-after';
      }
    }
    function finishUp() {
      if (!dragActive) { return; }
      dragActive = false;
      var hint = dropHint;
      cleanup();
      dropHint = null;
      if (!moved || !hint) { return; }
      if (hint.mode === 'append') {
        // R7 U11a fix-cycle parity restore: a release over blank canvas
        // space (trackAt's identical-purpose comment above has the full
        // rationale) moves the node to the ROOT END, same semantics the
        // retired native-DnD else-branch used (moveNodeTo(payload,null,null)).
        moveNodeTo(qid, null, null);
        selectComponent(qid);
        return;
      }
      if (!hint.qid || hint.qid === qid) { return; }
      if (hint.mode === 'into') { moveNodeTo(qid, hint.qid, null); }
      else {
        var ref = findRef(hint.qid);
        if (ref) { moveNodeTo(qid, ref.parent ? ref.parent.question_id : null, ref.index + (hint.mode === 'after' ? 1 : 0)); }
      }
      selectComponent(qid);
    }
    function onMoveInner(mEv) { trackAt(mEv.clientX, mEv.clientY, false); }
    function onMoveOuter(mEv) { trackAt(mEv.clientX, mEv.clientY, true); }
    function onUpInner() { finishUp(); }
    function onUpOuter() { finishUp(); }
    activeFieldMoveCleanup = cleanup;
    if (innerDoc && innerDoc.addEventListener) {
      innerDoc.addEventListener('mouseup', onUpInner);
      innerDoc.addEventListener('mousemove', onMoveInner);
    }
    document.addEventListener('mouseup', onUpOuter);
    document.addEventListener('mousemove', onMoveOuter);
  }
  // R2 S1-1/S1-2/S1-3: a MEASURED selection handle. All 8 handles are now
  // interactive (pointer-events:auto) with a real cursor and the axis/axes they
  // drive (wSide/hSide) — the register's "6 of 8 are dead decoration" is fixed.
  // Position is a MEASURED px offset (leftPx/topPx, relative to the wrap), never
  // the old hardcoded golden-demo -11/+19/+49 rows. The two mid E/W handles ALSO
  // carry the legacy data-width-handle + data-handle-side attributes so the
  // synthetic §7.1.3 width-drag test / r0a spike / forensic probe locators are
  // unchanged (the drag behavior now flows from data-fr-wside/data-fr-hside).
  function buildHandle(leftPx, topPx, cursor, wSide, hSide, qid) {
    var el = frameCreate('span');
    el.setAttribute('data-selection-chrome', '1');
    el.setAttribute('data-field-resize-handle', qid);
    el.setAttribute('data-fr-wside', wSide);
    el.setAttribute('data-fr-hside', hSide);
    if (wSide && !hSide) {
      el.setAttribute('data-width-handle', qid);
      el.setAttribute('data-handle-side', wSide);
    }
    // The measured position/cursor ride the variable part; the fixed appearance
    // (incl. the navy hex) is a SEPARATE declaration-list literal that STARTS with
    // a property name, in a single style-sink statement, so the §15.2 hex-lint
    // recognizes it as a style-sink CSS literal (the codebase idiom).
    el.setAttribute('style', 'position:absolute;left:' + leftPx + 'px;top:' + topPx + 'px;cursor:' + cursor + ';' + 'width:11px;height:11px;border-radius:3px;background:#1B3A5C;border:2px solid #1B3A5C;box-sizing:border-box;pointer-events:auto');
    el.addEventListener('mousedown', onWidthHandleMouseDown);
    return el;
  }
  // R2 adversarial-review MAJOR fix #1: the presentational counterpart of
  // buildHandle for a NON-size-consuming type (isSizeConsumingType false) —
  // the SAME visible box (position/dims/color) so selection chrome stays
  // consistent across all field-chrome types, but with NO resize affordance:
  // no per-axis cursor, no pointer-events:auto, no mousedown listener, and
  // none of the data-field-resize-handle/data-fr-wside/data-fr-hside/
  // data-width-handle locators a real or synthetic drag needs to find
  // something to grab. A drag attempt at this handle's position therefore
  // does nothing — it can never write a phantom design_overrides.size the
  // renderer doesn't consume (register U6/P6, the operator's "resize does
  // nothing" complaint through a new door).
  function buildInertHandle(leftPx, topPx) {
    var el = frameCreate('span');
    el.setAttribute('data-selection-chrome', '1');
    el.setAttribute('style', 'position:absolute;left:' + leftPx + 'px;top:' + topPx + 'px;' + 'width:11px;height:11px;border-radius:3px;background:#1B3A5C;border:2px solid #1B3A5C;box-sizing:border-box;pointer-events:none');
    return el;
  }
  function decorateFieldSelection(el, qid, node) {
    var wrap = ensureSelectionWrap(el);
    // R2 S1-1/S1-2: MEASURE the field's real box (getBoundingClientRect inside
    // the iframe doc) and derive ALL chrome geometry from it — no hardcoded
    // 66px height / -11/+19/+49 handle rows (those were copied from the golden's
    // one demo field and were wrong on every real field, worst on ones with a
    // helper line or a leading icon). Offsets are px relative to the wrap.
    var fr = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var wr = wrap.getBoundingClientRect ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var ox = fr.left - wr.left;
    var oy = fr.top - wr.top;
    var ow = fr.width;
    var oh = fr.height;
    // R2 adversarial-review MAJOR fix #1: whether THIS node's renderer
    // actually consumes design_overrides.size (see SIZE_CONSUMING_TYPES
    // above). Gates the resize handles + Custom badge below — the measured
    // outline + name tag stay for EVERY field-chrome type regardless (the
    // alignment contract holds for all of them; only the RESIZE affordance
    // is type-gated).
    var sizeConsuming = !!(node && isSizeConsumingType(node.type));
    var outline = frameCreate('div');
    outline.setAttribute('data-selection-chrome', '1');
    // The outline's border-box is COINCIDENT with the field box (measured), so
    // getBoundingClientRect(outline) === field rect (assertOverlayAligned <=4px
    // on x/y/w/h). The visible ring is drawn with the CSS outline + outline-offset
    // properties (painted OUTSIDE the border box, excluded from the measured
    // rect) so the ring shows a small margin WITHOUT moving the measured geometry.
    // The outline is ALWAYS pointer-events:none (presentation only) so the field
    // stays directly clickable — S1-5/S1-6's move-drag is armed on the FIELD
    // element itself (below), not by covering it.
    var outlinePe = 'pointer-events:none';
    // R7 U11a: the move gesture is NO LONGER bound per-field here. It is
    // DELEGATED once on the canvas surface (bindCanvasSurface → onFieldMove-
    // MouseDown), covering EVERY node type — not just this selected bare
    // input. The measured outline stays pointer-events:none (below) so the
    // node body is the drag surface; the delegated handler skips this
    // selection chrome so a drag on a handle still RESIZES.
    // The hex-bearing declaration-list literal STARTS with a property name in a
    // single .style.cssText sink statement (the §15.2 hex-lint idiom).
    outline.style.cssText = 'position:absolute;left:' + ox + 'px;top:' + oy + 'px;width:' + ow + 'px;height:' + oh + 'px;' + 'box-sizing:border-box;border-radius:12px;outline:2px solid #1B3A5C;outline-offset:3px;' + outlinePe;
    wrap.appendChild(outline);
    var tag = frameCreate('div');
    tag.setAttribute('data-selection-chrome', '1');
    // R7 U11a: a CHOICE-BEARING group's body is entirely covered by its
    // data-lg-choice children — onFieldMoveMouseDown deliberately skips
    // them (their click/native-DnD is §6.2's own pre-existing choice-select/
    // choice-reorder mechanism, load-bearing, untouched) — so the group has
    // NO body pixel left to grab for a WHOLE-GROUP move. The name TAG sits
    // ABOVE the field box (top: oy-28px), a disjoint region that never
    // overlaps a choice card, so arming it as a grab handle (pointer-
    // events:auto, cursor:move, mousedown -> startFieldMove) cannot ever
    // intercept a choice click/drag — the SAME "outline/chrome doubles as
    // the drag surface because the element's own body is claimed by
    // something else" precedent S1-5/S1-6 established for bare-input fields
    // (there: caret/text-selection; here: choice-card click/reorder),
    // generalized to this OTHER not-directly-grabbable type-class. Every
    // OTHER field-chrome type keeps the tag inert (pointer-events:none) —
    // their body IS the grab surface via the delegated onFieldMoveMouseDown.
    var isChoiceBearing = !!(node && typeMeta(node.type).choice === true);
    tag.style.cssText = 'position:absolute;top:' + (oy - 28) + 'px;left:' + ox + 'px;' + 'background:#1B3A5C;color:#fff;font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px 6px 6px 0;white-space:nowrap;' + (isChoiceBearing ? 'pointer-events:auto;cursor:move' : 'pointer-events:none');
    if (isChoiceBearing) {
      // a STABLE, semantic locator for the move-arming path above (over a
      // DOM-order-dependent one) — real-gesture specs target this directly.
      tag.setAttribute('data-move-handle', qid);
      tag.addEventListener('mousedown', function (tagEv) { startFieldMove(qid, tagEv); });
    }
    // §5.6's "Short text field" tag is scoped to the 8-value Accept-swap
    // text-input family (acceptFormatOfNode returns non-null ONLY for those
    // 8 types) — every OTHER field kind reaching this 8-handle chrome
    // (Buttons/Yes-No/Dropdown/Cards/Multi-select/Slider/…) shows its own
    // operator name, the SAME label the inspector scope header uses
    // (typeLabel/STUDIO_TYPE_META), so the canvas tag never lies about what's
    // selected (adversarial review M2).
    tag.appendChild(document.createTextNode(node && acceptFormatOfNode(node) ? 'Short text field' : typeLabel(node ? node.type : '')));
    wrap.appendChild(tag);
    // R2 S1-4: the custom badge covers EITHER axis (width takes precedence when
    // both are custom; the inspector's two chips disambiguate). Format is the
    // golden's "≈ N px · custom" (unchanged regex for the width-drag gates).
    // R2 adversarial-review MAJOR fix #1: gated on sizeConsuming — a
    // non-consuming type's node can never GAIN a custom_px through this
    // canvas anymore (the handles below are inert for it), but a value
    // authored some OTHER way (a legacy/API-authored node) must still not
    // show a badge implying a resize the renderer will not render.
    var customPxW = currentCustomWidthPx(node);
    var customPxH = currentCustomHeightPx(node);
    if (sizeConsuming && (customPxW !== null || customPxH !== null)) {
      var badge = frameCreate('div');
      badge.setAttribute('data-selection-chrome', '1');
      badge.style.cssText = 'position:absolute;top:' + (oy - 28) + 'px;left:' + (ox + ow) + 'px;transform:translateX(-100%);' + 'background:#1B3A5C;color:#fff;font-size:10.5px;font-weight:700;padding:4px 8px;border-radius:6px 6px 0 6px;pointer-events:none;white-space:nowrap';
      badge.appendChild(document.createTextNode('≈ ' + (customPxW !== null ? customPxW : customPxH) + ' px · custom'));
      wrap.appendChild(badge);
    }
    // 8 MEASURED handles: 4 corners (both axes) + 4 edge-midpoints (one axis).
    // A handle is 11px, centered on its point (offset -5.5). R2
    // adversarial-review MAJOR fix #1: a non-size-consuming type gets the
    // INERT look-alike (buildInertHandle) — same box, no affordance — so
    // "chrome for all 41 types" holds without a misleading resize on the ~33
    // types R3 hasn't wired yet (register S2-1).
    var leftX = ox - 5.5, rightX = ox + ow - 5.5, midX = ox + ow / 2 - 5.5;
    var topY = oy - 5.5, botY = oy + oh - 5.5, midY = oy + oh / 2 - 5.5;
    wrap.appendChild(sizeConsuming ? buildHandle(leftX, topY, 'nwse-resize', 'left', 'top', qid) : buildInertHandle(leftX, topY));
    wrap.appendChild(sizeConsuming ? buildHandle(rightX, topY, 'nesw-resize', 'right', 'top', qid) : buildInertHandle(rightX, topY));
    wrap.appendChild(sizeConsuming ? buildHandle(leftX, botY, 'nesw-resize', 'left', 'bottom', qid) : buildInertHandle(leftX, botY));
    wrap.appendChild(sizeConsuming ? buildHandle(rightX, botY, 'nwse-resize', 'right', 'bottom', qid) : buildInertHandle(rightX, botY));
    wrap.appendChild(sizeConsuming ? buildHandle(midX, topY, 'ns-resize', '', 'top', qid) : buildInertHandle(midX, topY));
    wrap.appendChild(sizeConsuming ? buildHandle(midX, botY, 'ns-resize', '', 'bottom', qid) : buildInertHandle(midX, botY));
    wrap.appendChild(sizeConsuming ? buildHandle(leftX, midY, 'ew-resize', 'left', '', qid) : buildInertHandle(leftX, midY));
    wrap.appendChild(sizeConsuming ? buildHandle(rightX, midY, 'ew-resize', 'right', '', qid) : buildInertHandle(rightX, midY));
  }
  // headline (golden :314-317) / continue (golden :352-355): outline + name
  // tag ONLY — no handles (§6.2: handles are field-type-only presentation).
  function decorateSimpleSelection(el, kind) {
    var wrap = ensureSelectionWrap(el);
    var outline = frameCreate('div');
    outline.setAttribute('data-selection-chrome', '1');
    outline.style.cssText = kind === 'continue'
      ? 'position:absolute;left:-6px;right:-6px;top:-6px;bottom:-6px;border:2px solid #1B3A5C;border-radius:14px;pointer-events:none'
      : 'position:absolute;left:-6px;right:-6px;top:-6px;bottom:-6px;border:2px solid #1B3A5C;border-radius:10px;pointer-events:none';
    wrap.appendChild(outline);
    var tag = frameCreate('div');
    tag.setAttribute('data-selection-chrome', '1');
    tag.style.cssText = 'position:absolute;top:-30px;left:-6px;background:#1B3A5C;color:#fff;font-size:11px;font-weight:600;padding:4px 9px;border-radius:6px 6px 6px 0;pointer-events:none;white-space:nowrap;display:flex;align-items:center;gap:6px';
    if (kind === 'continue') {
      tag.appendChild(document.createTextNode('Continue button'));
      var chip = frameCreate('span');
      chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;background:rgba(255,255,255,.18);padding:1px 6px;border-radius:10px;font-size:10px';
      chip.appendChild(document.createTextNode('funnel layout'));
      tag.appendChild(chip);
    } else {
      tag.appendChild(document.createTextNode('Question · shared with header'));
    }
    wrap.appendChild(tag);
  }

  function applyCanvasDecoration() {
    var region = canvasRegion();
    if (!region) { return; }
    // §8.8 linked-field chips + §5.4 frame badges REBUILD per pass (the region
    // is server HTML — every re-render wipes them, so decoration re-derives
    // from the model).
    var stale = region.querySelectorAll('.studio-maps-chip, .studio-frame-badge, .studio-choice-ghost, .studio-choice-x, .studio-resize-handle, .studio-mapoverlay-chip');
    var i;
    for (i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) { stale[i].parentNode.removeChild(stale[i]); }
    }
    clearSelectionChrome(region);
    var nodes = region.querySelectorAll('[data-question-id]');
    var qid, base, ref, labels, chip, nodeType, chromeKind;
    var selEl = null, selKind = null, selNode = null, selQid = null;
    for (i = 0; i < nodes.length; i++) {
      qid = nodes[i].getAttribute('data-question-id');
      ref = findRef(qid);
      chromeKind = (qid === selectedQuestionId && ref) ? selectionChromeKind(ref.node) : null;
      // R7 U11a: EVERY canvas node is draggable="false" now. Native HTML5 DnD
      // is retired for canvas moves — every node type (bare inputs AND choice
      // groups / currency / address / containers alike) reorders through the
      // ONE delegated pointer gesture (onFieldMoveMouseDown), a real page.mouse
      // can drive (unlike native DnD into the srcdoc iframe, which hangs in
      // Chrome automation and failed for the operator). Native DnD survives
      // ONLY for the parent-doc palette-tile INSERT (drag starts outside the
      // iframe → no hang) and intra-group choice-card reorder. A drag starting
      // ON a resize handle still RESIZES (the handle's own mousedown +
      // onFieldMoveMouseDown's [data-selection-chrome] skip).
      nodeType = nodes[i].getAttribute('data-component-type');
      nodes[i].setAttribute('draggable', 'false');
      base = withoutClasses(nodes[i].className, [SELECT_CLASS]);
      nodes[i].className = qid === selectedQuestionId ? base + ' ' + SELECT_CLASS : base;
      // §5.4: legacy frame-scope node → amber badge (unless Keep-acknowledged
      // this session). Inserted as a SIBLING above the node element.
      if (typeMeta(nodeType).scope === 'frame' && keptLegacyFrameNodes[qid] !== true && nodes[i].parentNode) {
        nodes[i].parentNode.insertBefore(buildFrameBadge(qid, nodeType), nodes[i]);
      }
      // chip: "fills: city, state" from the config's autofill keys. Inserted
      // as a SIBLING (the ZIP node element is the <input> itself — it cannot
      // contain children).
      labels = ref ? mapsFillLabels(ref.node) : [];
      if (labels.length > 0 && nodes[i].parentNode) {
        chip = frameCreate('span');
        chip.className = 'studio-maps-chip';
        chip.setAttribute('data-studio-maps-chip', '');
        chip.setAttribute('data-chip-for', qid);
        chip.setAttribute('data-fills', labels.join(','));
        chip.appendChild(document.createTextNode('fills: ' + labels.join(', ')));
        nodes[i].parentNode.insertBefore(chip, nodes[i].nextSibling);
      }
      // §6.2 golden selection chrome (field 8-handles / headline / continue):
      // only the CURRENTLY selected node, and only these 3 golden kinds
      // (containers keep their existing .studio-resize-handle mechanism). CAPTURE
      // it here but DECORATE it AFTER decorateChoiceCards (below) — R2 S1-1/S1-2:
      // the measured overlay must enclose the group's FINAL box, and
      // decorateChoiceCards appends the "+ Add choice" ghost to a selected choice
      // group, growing its height AFTER this loop would have measured it.
      if (chromeKind === 'field' || chromeKind === 'headline' || chromeKind === 'continue') {
        selEl = nodes[i]; selKind = chromeKind; selQid = qid; selNode = ref.node;
      }
    }
    decorateChoiceCards(region);
    decorateMappingOverlay(region);
    // §6.2 measured selection chrome LAST — after the ghost/choice-X inserts, so
    // getBoundingClientRect reflects the node's final laid-out box.
    if (selKind === 'field') { decorateFieldSelection(selEl, selQid, selNode); }
    else if (selKind === 'headline' || selKind === 'continue') { decorateSimpleSelection(selEl, selKind); }
    // badges/chips/handles change the document height — keep the frame sized.
    updateCanvasFrameHeight();
  }
  function clearDropClasses() {
    var region = canvasRegion();
    if (!region) { return; }
    var marked = region.querySelectorAll('.studio-drop-before, .studio-drop-after, .studio-drop-into');
    var i;
    for (i = 0; i < marked.length; i++) { marked[i].className = withoutClasses(marked[i].className, DROP_CLASSES); }
  }

  // --- §7.1 scope header + §7.2 pills ------------------------------------------
  // The blast-radius sentence per scope — Section scope cites the live
  // "Used in N quotes" reuse line (§2.4); C6 vocabulary only (this comment
  // ships with the island — keep it token-clean for the copy lint).
  function scopeAffectsText(node) {
    if (scopeState === 'choice') { return 'Affects: this card only.'; }
    if (scopeState === 'component' && node) {
      if (typeMeta(node.type).scope === 'frame') {
        return 'Affects: a funnel-layout element kept inside this Section \\u2014 the funnel layout itself is edited in the Quote Builder.';
      }
      return 'Affects: this question unit \\u2014 in every quote that uses this Section.';
    }
    if (usageQuoteCount === null) { return 'Affects: changes apply everywhere this Section is used.'; }
    if (usageQuoteCount === 0) { return 'Affects: not used in any quote yet.'; }
    return 'Affects: used in ' + usageQuoteCount + ' quote' + (usageQuoteCount === 1 ? '' : 's') + '; changes apply everywhere it\\u2019s used.';
  }
  // v3.1 audit-round G FIX 2: the §8.1 affects line, returned as STRUCTURED
  // PARTS so the caller builds it with SAFE DOM nodes (never innerHTML). Each
  // returns a {before,bold,after} split whose bold segment the caller paints
  // #5C5015 (golden bold color). The headline + accept-format selections stay
  // byte-for-byte with the golden (Appendix A §7.3, golden :422-424) — the
  // em-dash rides \\u2014 and the ampersand is a bare '&' exactly as the golden
  // emits it. The ContinueButton selection's copy is the U15 operator-ordered
  // clarity erratum (2026-07-15): it drops the incomprehensible "funnel frame"
  // jargon for the destination-named "shared by every section ... set in the
  // Quote Builder" (renderScopePillsMarkup / renderStudioInspector are
  // reclassified golden:false in golden-allowlist.json). Every OTHER selection
  // (choices/containers/frame-scope/section) returns {text:...} = the
  // operator-true generic scopeAffectsText copy.
  function scopeAffectsParts(node) {
    if (scopeState === 'component' && node) {
      if (node.bind !== undefined) {
        return { before: 'This is the same text as the ', bold: 'Question headline', after: ' box up top \\u2014 editing either updates both.' };
      }
      if (node.type === 'ContinueButton') {
        return { before: 'Color, size & position are shared by every section in this funnel \\u2014 set in the ', bold: 'Quote Builder', after: '. Here you can change only the label.' };
      }
      if (acceptFormatOfNode(node)) {
        return { before: 'Changes here affect ', bold: 'this question only', after: ', everywhere this section is reused.' };
      }
    }
    return { text: scopeAffectsText(node) };
  }
  // Paint the affects parts into el via text nodes + one bold (#5C5015) node —
  // no innerHTML (the copy is constant chrome, but safe DOM is the standard).
  function renderAffectsParts(el, parts) {
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (parts.text !== undefined) { el.appendChild(document.createTextNode(parts.text)); return; }
    el.appendChild(document.createTextNode(parts.before));
    var strong = document.createElement('b');
    strong.style.color = '#5C5015';
    strong.appendChild(document.createTextNode(parts.bold));
    el.appendChild(strong);
    el.appendChild(document.createTextNode(parts.after));
  }
  function scopeEditingName(node) {
    if (scopeState === 'choice') { return 'Answer choice \\u201C' + choiceScopeLabel + '\\u201D'; }
    // §5.6/§8.1: "the inspector name is always 'Short text field'" for the
    // 8-value Accept-swap family — the SAME special-case decorateFieldSelection
    // already applies to the canvas name-tag (its own comment names this
    // exact parity goal); every other field type keeps its own catalog label.
    if (scopeState === 'component' && node) { return acceptFormatOfNode(node) ? 'Short text field' : typeLabel(node.type); }
    return 'This Section (question unit)';
  }
  // §8.1 "what it is" one-line description. Three rows are contract-ASSERTED
  // fixture strings (ZIP field / headline / continue); every OTHER selection
  // has no asserted copy (a recorded contract gap — never invented), so it
  // falls back to the REAL catalog description already shipped for every
  // type (typeMeta(type).description, the same data the library tiles use),
  // never a fabricated sentence.
  function scopeWhatItIs(node) {
    if (scopeState !== 'component' || !node) { return ''; }
    if (node.bind !== undefined) { return 'The main ask of this question'; }
    if (node.type === 'ContinueButton') { return 'Moves to the next question'; }
    if (acceptFormatOfNode(node) === 'us_zip') { return 'Collects the visitor\\u2019s ZIP'; }
    return typeMeta(node.type).description || '';
  }
  var scopeFlashTimer = null;
  function renderScopeHeader() {
    var header = document.querySelector('[data-studio-scope-header]');
    if (!header) { return; }
    var node = selectedNode();
    if (scopeState !== 'section' && !node) { scopeState = 'section'; }
    var nameEl = header.querySelector('[data-scope-editing-name]');
    var affectsEl = header.querySelector('[data-scope-affects]');
    var whatEl = header.querySelector('[data-scope-what-it-is]');
    var changed = false;
    var newName = scopeEditingName(node);
    if (nameEl && nameEl.textContent !== newName) { nameEl.textContent = newName; changed = true; }
    if (affectsEl) { renderAffectsParts(affectsEl, scopeAffectsParts(node)); }
    if (whatEl) {
      var whatText = scopeWhatItIs(node);
      whatEl.textContent = whatText;
      whatEl.hidden = whatText === '';
    }
    // §6.1.2: ONE pill implementation, two hosts — every instance syncs.
    var pills = document.querySelectorAll('[data-scope-pill]');
    var i, key, active;
    var meta = node ? typeMeta(node.type) : {};
    for (i = 0; i < pills.length; i++) {
      key = pills[i].getAttribute('data-scope-pill');
      active = key === scopeState;
      pills[i].className = active ? 'studio-scope-pill active' : 'studio-scope-pill';
      pills[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      // MINOR 9: frame is never an ACTIVE scope here (Quote-Builder-owned) —
      // the pill is a DEEP LINK to the using funnel's Quote Builder, disabled
      // only while ZERO funnels use this Section; component needs a
      // selection; choice needs a choice-bearing selection.
      if (key === 'frame') { pills[i].disabled = usageFunnelsOf().length === 0; }
      if (key === 'component') { pills[i].disabled = !node; }
      if (key === 'choice') { pills[i].disabled = !node || meta.choice !== true; }
    }
    // §7.2: the retarget is SEEN — a brief flash on the aria-live region.
    if (changed) {
      header.className = 'studio-scope-header studio-scope-flash';
      if (scopeFlashTimer) { clearTimeout(scopeFlashTimer); }
      scopeFlashTimer = setTimeout(function () {
        scopeFlashTimer = null;
        header.className = 'studio-scope-header';
      }, 400);
    }
  }
  function setScope(scope) {
    scopeState = scope;
    if (scope !== 'choice') { selectedChoiceValue = null; }
    renderScopeHeader();
    updateCanvasToolbar();
  }

  // --- selection + §6.1 toolbar render layer ------------------------------------
  // §6.1.1 clickable breadcrumb: root crumb = the scope ("This Section"); each
  // ancestor crumb re-selects it; a focused choice appends its crumb.
  function crumbHandler(qid) { return function () { selectComponent(qid); }; }
  function renderBreadcrumb() {
    var crumb = document.querySelector('[data-studio-breadcrumb]');
    if (!crumb) { return; }
    clearChildren(crumb);
    var root = document.createElement('button');
    root.type = 'button';
    root.setAttribute('data-crumb', '');
    // §6.1 breadcrumb (golden :267, Appendix A): root text is "This section"
    // (lowercase s) — always the muted root label, never chip-styled (the
    // golden's chip is reserved for the CURRENT selection level).
    if (!selectedQuestionId) { root.className = 'studio-crumb-current'; }
    root.appendChild(document.createTextNode('This section'));
    root.addEventListener('click', function () { selectComponent(null); });
    crumb.appendChild(root);
    if (!selectedQuestionId) { return; }
    var ref = findRef(selectedQuestionId);
    if (!ref) { return; }
    var i, sep, b;
    for (i = 0; i < ref.trail.length; i++) {
      sep = document.createElement('span');
      sep.appendChild(document.createTextNode(' \\u203A '));
      crumb.appendChild(sep);
      b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-crumb', ref.trail[i].question_id);
      if (i === ref.trail.length - 1 && !(scopeState === 'choice' && selectedChoiceValue !== null)) { b.className = 'studio-crumb-current'; }
      b.appendChild(document.createTextNode(typeLabel(ref.trail[i].type)));
      b.addEventListener('click', crumbHandler(ref.trail[i].question_id));
      crumb.appendChild(b);
    }
    if (scopeState === 'choice' && selectedChoiceValue !== null) {
      sep = document.createElement('span');
      sep.appendChild(document.createTextNode(' \\u203A '));
      crumb.appendChild(sep);
      b = document.createElement('span');
      b.className = 'studio-crumb-current';
      b.setAttribute('data-crumb-choice', String(selectedChoiceValue));
      b.appendChild(document.createTextNode('Choice \\u201C' + choiceScopeLabel + '\\u201D'));
      crumb.appendChild(b);
    }
  }
  // §6.7: the selected node's validation problems inline at the control (red
  // outline + one sentence in the toolbar).
  function renderToolbarProblems() {
    var marked = document.querySelectorAll('.studio-control-invalid');
    var i;
    for (i = 0; i < marked.length; i++) { marked[i].className = withoutClasses(marked[i].className, ['studio-control-invalid']); }
    var el = document.querySelector('[data-toolbar-problems]');
    if (!el) { return; }
    var node = selectedNode();
    if (!node) { el.hidden = true; el.textContent = ''; return; }
    var issues = computeIssues();
    var mine = [];
    for (i = 0; i < issues.length; i++) { if (issues[i].qid === node.question_id) { mine.push(issues[i]); } }
    if (mine.length === 0) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = mine[0].message + (mine.length > 1 ? ' (+' + (mine.length - 1) + ' more)' : '');
    var key, ctl;
    for (i = 0; i < mine.length; i++) {
      key = issueControlKeyOf(mine[i].message);
      if (key === null) { continue; }
      if (key === 'choices') { ctl = document.getElementById('lg-choice-add'); }
      else {
        ctl = document.querySelector('[data-inspector-field="' + key + '"]') ||
          document.querySelector('[data-inspector-vprop="' + key + '"]') ||
          document.querySelector('[data-container-prop="' + key + '"]');
      }
      if (ctl && ctl.className.indexOf('studio-control-invalid') === -1) { ctl.className = ctl.className + ' studio-control-invalid'; }
    }
  }
  // §6.5: the toolbar clusters are a PURE function of the selection.
  // R5 D3 (register S4-A3): updateCanvasToolbar now only owns the SURVIVING
  // toolbar chrome — undo/viewport (unconditional), the "More" popover's
  // structure/choice clusters (relocated markup, same visibility rule), and
  // the choice-value chip/badge/disabled pressed-state (still inside that
  // popover). Every per-control block this function used to own for the
  // DELETED (add-choice/autoadvance/accept/input-quick/text-color) or
  // MIGRATED (selected-role/choice-layout/searchable/card-style/slider-
  // format) controls is gone — the migrated ones get their OWN visibility
  // refresh inside populateInspector/populateStyleVariant (Content/Style
  // tabs), the deleted ones have no surviving element to toggle at all. The
  // copy-node Type-swap select (data-text-role) is the one control whose
  // VALUE-SYNC logic stays here unchanged — a relocated-but-attribute-
  // addressed element, unaffected by which tab hosts it.
  function updateCanvasToolbar() {
    var node = selectedNode();
    var choiceFocused = scopeState === 'choice' && selectedChoiceValue !== null;
    var visible = toolbarClustersFor(node, choiceFocused);
    var clusters = document.querySelectorAll('[data-toolbar-cluster]');
    var i, key;
    for (i = 0; i < clusters.length; i++) {
      key = clusters[i].getAttribute('data-toolbar-cluster');
      clusters[i].hidden = visible.indexOf(key) === -1;
    }
    // R5 D3: the "More" button/popover show only when the selection has
    // structure or choice actions available; force-close the popover when it
    // stops being relevant so a later, unrelated selection never inherits a
    // stale open state.
    var hasMore = visible.indexOf('structure') !== -1 || visible.indexOf('choice') !== -1;
    var moreBtn = document.querySelector('[data-studio-more-toggle]');
    var morePanel = document.querySelector('[data-studio-more-panel]');
    if (moreBtn) { moreBtn.hidden = !hasMore; }
    if (!hasMore && morePanel && !morePanel.hidden) {
      morePanel.hidden = true;
      if (moreBtn) { moreBtn.setAttribute('aria-expanded', 'false'); }
    }
    var textRoleSel = document.querySelector('[data-text-role]');
    if (textRoleSel && node && TEXT_ROLE_TYPES.indexOf(node.type) !== -1) {
      textRoleSel.value = node.type;
      textRoleSel.disabled = node.bind !== undefined;
    }
    var chip = document.querySelector('[data-choice-value-chip]');
    var c = (node && choiceFocused) ? findChoice(node, selectedChoiceValue) : null;
    if (chip) { chip.textContent = choiceFocused ? String(selectedChoiceValue) : 'value'; }
    var badgeBtn = document.querySelector('[data-choice-act="badge"]');
    if (badgeBtn) { badgeBtn.setAttribute('aria-pressed', c && typeof c.badge === 'string' && c.badge !== '' ? 'true' : 'false'); }
    var disBtn = document.querySelector('[data-choice-act="disabled"]');
    if (disBtn) { disBtn.setAttribute('aria-pressed', c && c.disabled === true ? 'true' : 'false'); }
    updateHistoryButtons();
    renderToolbarProblems();
  }
  // §6.2 "Default selection on open = the ZIP field" (contract) generalizes
  // to: the FIRST real answer-collecting node (produces !== null), skipping
  // bound copy nodes — the §1.2 fixture's one field happens to be the ZIP
  // question, but this works for any Section's content.
  function findDefaultSelectionId() {
    var found = null;
    walkTree(state.content.components, 1, function (n) {
      if (found === null && n.bind === undefined && typeMeta(n.type).produces) { found = n.question_id; }
    });
    return found;
  }
  function selectComponent(qid) {
    // m3 (adversarial re-review) extra robustness: a selection change is the
    // other place a stale width-drag (moved, but its own mouseup was lost
    // off-window) should be torn down proactively — see afterModelChange's
    // matching guard for the full rationale (incl. why this is
    // typeof-guarded: selectComponent is also sliced standalone elsewhere).
    if (typeof activeWidthDragCleanup !== 'undefined' && activeWidthDragCleanup) { activeWidthDragCleanup(); }
    selectedQuestionId = qid || null;
    scopeState = selectedQuestionId ? 'component' : 'section';
    selectedChoiceValue = null;
    applyCanvasDecoration();
    renderBreadcrumb();
    if (!selectedQuestionId && pendingInsert) { pendingInsert = null; updatePendingUi(); }
    populateInspector(true);
    renderInspectorMapping();
    renderScopeHeader();
    updateCanvasToolbar();
  }
  // §6.2/§6.4 per-choice selection: clicking a card/button selects the CHOICE;
  // the inspector simultaneously opens the Choices tab scrolled to that row.
  function focusChoiceRow(value) {
    var rows = document.querySelectorAll('[data-choice-row]');
    var i, inp, label;
    for (i = 0; i < rows.length; i++) {
      inp = rows[i].querySelector('[data-choice-field="value"]');
      if (inp && String(inp.value) === String(value)) {
        if (rows[i].scrollIntoView) { rows[i].scrollIntoView({ block: 'nearest' }); }
        label = rows[i].querySelector('[data-choice-field="label"]');
        if (label && label.focus) { label.focus(); }
        return true;
      }
    }
    return false;
  }
  function selectChoice(qid, value) {
    selectedQuestionId = qid || null;
    var node = selectedNode();
    if (!node || typeMeta(node.type).choice !== true) { selectComponent(qid); return; }
    selectedChoiceValue = value;
    var c = findChoice(node, value);
    choiceScopeLabel = c && c.label !== undefined ? String(c.label) : '';
    scopeState = 'choice';
    applyCanvasDecoration();
    renderBreadcrumb();
    populateInspector(true);
    renderInspectorMapping();
    // v3.1 §8.2: choices now live INSIDE the Content tab (folded from the
    // old standalone 'choices' tab) — open Content, not a dead panel key.
    setInspectorTab('content');
    // populateInspector/setInspectorTab may have re-scoped — re-assert CHOICE.
    scopeState = 'choice';
    focusChoiceRow(value);
    renderScopeHeader();
    updateCanvasToolbar();
  }

  // --- inspector tabs (§7.3: DYNAMIC per selection — never a fixed strip) -------
  // v3.1 §8.2 — the 5 DYNAMIC tabs (never a fixed strip), per the table's
  // EXACT 3-row partition: Answer/input field = Content·Style·Rules·Maps*·
  // Offers; Bound headline/subheadline/Text = Content·Style ONLY; Continue
  // button = Content·Style ONLY. "Advanced" is a persistent disclosure
  // OUTSIDE this tab system now (setAdvancedOpen below), so it is never
  // returned here. Simplification (flagged, reported): the pre-v3.1
  // frame-scope special-case (page-frame elements got NO design/
  // dependencies tabs) is folded into the general rule — a frame-scope node
  // still only shows 'maps'/'offers' when meta.maps/meta.produces are
  // truthy (never true for frame-scope catalog entries), so it now ALSO gets
  // 'style' and 'rules' where before it got neither — a capability EXPANSION,
  // never a regression (no existing affordance is removed). This
  // frame-scope carve-out is DISTINCT from (and does not touch) the
  // contract's explicit bound/Continue restriction below.
  // v3.1 R3b E2-NEW-5: the 4 text-primitive types are Content·Style ONLY per
  // §8.2's table (same row as the bound headline/Continue exclusions below) —
  // a TextBlock/CategoryLabel/HelperText/LegalNote selection has no rule
  // condition to author (it never gates visibility of anything else).
  var RULES_EXCLUDED_TEXT_TYPES = { TextBlock: 1, CategoryLabel: 1, HelperText: 1, LegalNote: 1 };
  function availableTabsFor(node) {
    if (!node) { return []; }
    var meta = typeMeta(node.type);
    var tabs = [];
    var isBound = node.bind !== undefined;
    var isContinue = node.type === 'ContinueButton';
    // Content shows for a COPY-BEARING or CHOICE-BEARING selection (§8.2): a
    // type with content props, a §5.2 BOUND node, or a choice-bearing type
    // (it hosts the Choices sub-block even absent its own content_props).
    // v3.1 R3b deliverable 4: ImageBlock also always qualifies — its source/
    // alt/media controls live in a DEDICATED block (data-content-imageblock-
    // block), not the generic CONTENT_PROP_FIELDS rows, so content_props is
    // deliberately [] for it and would otherwise wrongly hide the tab.
    // v3.1 R3b deliverable 8: the 10 frame-scope types also always qualify —
    // Content shows the read-only notice (data-content-framescope-block)
    // rather than dead editing controls.
    var hasContent = isBound || (meta.content_props || []).length > 0 || meta.choice === true || node.type === 'ImageBlock' || FRAME_SCOPE_STUDIO_TYPES[node.type] === 1;
    if (hasContent) { tabs.push('content'); }
    // Style: any visual selection (§8.5 "any visual selection").
    tabs.push('style');
    // Rules: the contract's table EXCLUDES it for the bound headline/
    // subheadline/Text row and the Continue-button row — both are
    // Content·Style ONLY. Every other selection (fields, choices,
    // containers) keeps the dependency evaluator.
    if (!isBound && !isContinue && RULES_EXCLUDED_TEXT_TYPES[node.type] !== 1) { tabs.push('rules'); }
    // Maps: ZIP/Address types only (§8.2 "*Maps only for ZIP/Address types").
    if (meta.maps) { tabs.push('maps'); }
    // Offers: answer-producing types only (folds the old 'mapping' tab).
    if (meta.produces) { tabs.push('offers'); }
    return tabs;
  }
  var advancedOpen = false;
  // §8.8: the Advanced disclosure — collapsed by default for EVERY selection
  // (contract-asserted), opening emits the console-only section_advanced_opened
  // event (§7.5's tracking requirement, carried over from the old Advanced TAB).
  function setAdvancedOpen(open) {
    advancedOpen = open;
    if (open && window.console && window.console.info) {
      window.console.info('section_advanced_opened', { section: state.public_id || 'new', component: selectedQuestionId });
    }
    var toggle = document.querySelector('[data-studio-advanced-toggle]');
    var body = document.querySelector('[data-studio-advanced-body]');
    if (toggle) { toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    if (body) { body.hidden = !open; }
  }
  function setInspectorTab(key) {
    // Leaving the Content tab ends the choice scope (§7.2 retarget) — Choices
    // now lives INSIDE Content (folded per §8.2), not its own tab.
    if (key !== 'content' && scopeState === 'choice') { scopeState = selectedQuestionId ? 'component' : 'section'; renderScopeHeader(); }
    currentInspectorTab = key;
    var tabs = document.querySelectorAll('[data-studio-inspector-tab]');
    var panels = document.querySelectorAll('[data-studio-panel]');
    var i, k;
    for (i = 0; i < tabs.length; i++) {
      k = tabs[i].getAttribute('data-studio-inspector-tab');
      tabs[i].className = k === key ? 'studio-tab active' : 'studio-tab';
      tabs[i].setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
    for (i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-studio-panel') !== key;
    }
  }

  // --- inspector populate ------------------------------------------------------
  function inspectorFieldValue(node, field) {
    if (!node) { return ''; }
    if (field === 'required') { return node.required === true; }
    if (field === 'internal_field') { return node.internal_field; }
    if (field === 'question_key') { return node.question_key; }
    if (field === 'design_preset') { return node.design_preset; }
    // v3.1 audit-round G FIX 3b: the Helper-text control is canonical
    // props.helper, with a read-fallback to the legacy props.helper_text
    // (erratum 8) so a v2.5 section still shows its saved helper on load.
    if (field === 'helper' && node.props) {
      return node.props.helper !== undefined ? node.props.helper : node.props.helper_text;
    }
    return node.props ? node.props[field] : '';
  }
  // v3.1 R3b deliverable 8 (E2-NEW-3/E2-NEW-8/E2-C4): frame.ts synthesizes its
  // OWN chrome for these 10 types — an in-Section instance's props are
  // production-inert (double-chrome risk if BOTH render). Explicit type list
  // (not meta.scope==='frame': TrustBar/LogoStrip are catalog scope:"both",
  // legitimately placeable in a Section, but STILL frame-duplicated for this
  // exact concern) per the register's own framing.
  var FRAME_SCOPE_STUDIO_TYPES = { HeaderBar: 1, FooterBar: 1, TrustBar: 1, LogoStrip: 1, StepIndicator: 1, ProgressBar: 1, HeaderLogo: 1, BackButton: 1, DisclosureLink: 1, BackgroundPanel: 1 };
  // §8.1/§8.4: the Content tab shows exactly ONE of headline/continue/frame_scope/field.
  function contentVariantOf(node) {
    if (!node) { return null; }
    if (node.bind !== undefined) { return 'headline'; }
    if (node.type === 'ContinueButton') { return 'continue'; }
    if (FRAME_SCOPE_STUDIO_TYPES[node.type] === 1) { return 'frame_scope'; }
    return 'field';
  }
  // §8.5b: the Style tab shows exactly ONE of field/text/continue/frame_scope
  // variants. "Text/bound headline" = TextBlock (role-based) OR any bound
  // node OR the pre-§5.3 discrete text-role types (TEXT_ROLE_TYPES) —
  // preserving every existing text-ish selection's style surface.
  function styleVariantOf(node) {
    if (!node) { return null; }
    if (node.type === 'ContinueButton') { return 'continue'; }
    if (node.type === 'TextBlock' || node.bind !== undefined || TEXT_ROLE_TYPES.indexOf(node.type) !== -1) { return 'text'; }
    if (FRAME_SCOPE_STUDIO_TYPES[node.type] === 1) { return 'frame_scope'; }
    return 'field';
  }
  function populateContentVariant(node) {
    var variant = contentVariantOf(node);
    var headlineBlock = document.querySelector('[data-content-headline-block]');
    var continueBlock = document.querySelector('[data-content-continue-block]');
    var fieldBlock = document.querySelector('[data-content-field-block]');
    var frameScopeBlock = document.querySelector('[data-content-framescope-block]');
    if (headlineBlock) { headlineBlock.hidden = variant !== 'headline'; }
    if (continueBlock) { continueBlock.hidden = variant !== 'continue'; }
    if (fieldBlock) { fieldBlock.hidden = variant !== 'field'; }
    if (frameScopeBlock) { frameScopeBlock.hidden = variant !== 'frame_scope'; }
    if (variant === 'headline') {
      var hIn = document.querySelector('[data-bound-shared-input="section_headline"]');
      var sIn = document.querySelector('[data-bound-shared-input="section_subheadline"]');
      var hStrip = stripInputFor('section_headline');
      var sStrip = stripInputFor('section_subheadline');
      if (hIn) { hIn.value = hStrip ? hStrip.value : ''; }
      if (sIn) { sIn.value = sStrip ? sStrip.value : ''; }
    }
  }
  function populateStyleVariant(node) {
    var variant = styleVariantOf(node);
    var fieldBlock = document.querySelector('[data-style-field-block]');
    var textBlock = document.querySelector('[data-style-text-block]');
    var continueBlock = document.querySelector('[data-style-continue-block]');
    var frameScopeStyleBlock = document.querySelector('[data-style-framescope-block]');
    if (fieldBlock) { fieldBlock.hidden = variant !== 'field'; }
    if (textBlock) { textBlock.hidden = variant !== 'text'; }
    if (continueBlock) { continueBlock.hidden = variant !== 'continue'; }
    if (frameScopeStyleBlock) { frameScopeStyleBlock.hidden = variant !== 'frame_scope'; }
    // v3.1 R3 (register S2-1/E1-C3/E2-NEW-7): the Width/Height/Corners/Border
    // quad renders ONLY where the renderer CONSUMES those overrides
    // (isSizeConsumingType) — a 'field'-variant type whose renderer ignores
    // size/corners/border (containers, Range family, NameFieldsGroup) shows an
    // EMPTY size-appearance section instead of dead controls.
    var consumesSize = !!(node && isSizeConsumingType(node.type));
    var sizeAppear = document.querySelector('[data-style-size-appearance]');
    if (sizeAppear) { sizeAppear.hidden = variant !== 'field' || !consumesSize; }
    if (variant === 'field' && consumesSize) { populateSizeControls(node); populateCornersBorderControls(node); }
    if (variant === 'text') { populateTextRoleControls(node); }
    if (variant === 'continue') { populateContinueStyleRows(); }
    // R5 D3 (register S4-A3 migration): "Selected-state style" (button/icon
    // role) + "Card layout" (columns/gap) — MIGRATED from the canvas
    // toolbar's "component"/"layout" clusters, same gating conditions.
    var presetRow = document.querySelector('[data-preset-row]');
    if (presetRow) { presetRow.hidden = variant !== 'field' || !node; }
    var choiceExtras = document.querySelector('[data-style-choice-extras]');
    var isChoiceFamily = variant === 'field' && !!node && typeMeta(node.type).choice === true;
    if (choiceExtras) { choiceExtras.hidden = !isChoiceFamily; }
    var selButton = document.querySelector('[data-tb-selected-role="button"]');
    if (selButton) { selButton.hidden = !node || (node.type !== 'ButtonAnswerGroup' && node.type !== 'TwoButtonYesNo' && node.type !== 'OtherGroupSelector'); }
    // FIX 4b: MultiChoiceCardGroup has NO icon slot — its iconColor swatch was
    // a dead write; the selected-icon role shows only for the two card grids.
    var selIcon = document.querySelector('[data-tb-selected-role="icon"]');
    if (selIcon) { selIcon.hidden = !isCardGridType(node); }
    // FIX 4b: only renderCardGrid consumes columns/gridGap overrides — gated
    // to the two card grids (ButtonAnswerGroup/dropdowns/MultiChoiceCardGroup
    // wrote dead keys).
    var choiceLayout = document.querySelector('[data-toolbar-choice-layout]');
    if (choiceLayout) { choiceLayout.hidden = !isCardGridType(node); }
  }
  // §6.2 "Selecting a node retargets the inspector and resets its active tab
  // to Content" — a NEW SELECTION (isNewSelection=true, from
  // selectComponent/selectChoice ONLY) forces the tab back to Content
  // (falling back to the first available tab if Content isn't offered, e.g.
  // a structural container). A property-mutation refresh (preset apply,
  // override reset/convert, Accept-swap, continue-mode — every OTHER
  // populateInspector caller) must NOT yank the operator off whatever tab
  // they are actively editing, so it keeps the pre-existing
  // stay-if-still-available behavior.
  function populateInspector(isNewSelection) {
    var node = selectedNode();
    var meta = node ? typeMeta(node.type) : {};
    var isBound = !!node && node.bind !== undefined;
    // §7.1: the scope header (operator words) replaced the old id/type head;
    // the Section-scope helper note shows only while nothing is selected.
    var scopeNote = document.querySelector('[data-studio-section-scope-note]');
    if (scopeNote) { scopeNote.hidden = !!node; }
    var avail = availableTabsFor(node);
    var tabs = document.querySelectorAll('[data-studio-inspector-tab]');
    var i, k;
    for (i = 0; i < tabs.length; i++) {
      k = tabs[i].getAttribute('data-studio-inspector-tab');
      tabs[i].hidden = avail.indexOf(k) === -1;
    }
    if (avail.length === 0) { setInspectorTab('none'); }
    else if (isNewSelection === true && avail.indexOf('content') !== -1) { setInspectorTab('content'); }
    else if (avail.indexOf(currentInspectorTab) === -1) { setInspectorTab(avail[0]); }
    else { setInspectorTab(currentInspectorTab); }
    // §8.8 "collapsed by default": a NEW selection re-collapses Advanced.
    if (isNewSelection === true) { setAdvancedOpen(false); }

    populateContentVariant(node);
    populateStyleVariant(node);

    // content controls: only the selected type's copy fields are visible
    // (unchanged mechanism — now scoped inside data-content-field-block).
    var wraps = document.querySelectorAll('[data-content-prop]');
    var cp = meta.content_props || [];
    var anyContent = isBound;
    for (i = 0; i < wraps.length; i++) {
      k = wraps[i].getAttribute('data-content-prop');
      // v3.1 R3 E1-C4: a native <input type="date"> ignores placeholder
      // (browser no-op), so hide the Placeholder Content control for DateQuestion.
      var dateNoPlaceholder = !!node && node.type === 'DateQuestion' && k === 'placeholder';
      var on = !!node && cp.indexOf(k) !== -1 && !(isBound && k === 'text') && !dateNoPlaceholder;
      wraps[i].hidden = !on;
      if (on) { anyContent = true; }
    }
    var emptyNote = document.querySelector('[data-content-empty]');
    if (emptyNote) { emptyNote.hidden = anyContent || !node; }

    // §8.3 Basics: Field label + Leading icon — the 8 Accept-swappable types
    // only (dedicated controls, distinct from the generic CONTENT_CONTROLS
    // "label"/"icon" rows used by other types — see CONTENT_PROP_FIELDS).
    var acceptFmt = acceptFormatOfNode(node);
    var labelWrap = document.querySelector('[data-field-label-wrap]');
    if (labelWrap) { labelWrap.hidden = acceptFmt === null; if (acceptFmt !== null) { anyContent = true; } }
    // v3.1 R3a (conductor-ruled consumption-honesty addition): of the 8 Accept-
    // swappable types, CurrencyInputQuestion is the ONE renderer that does NOT
    // consume props.icon — renderCurrencyInputQuestion has no fieldLeadingIcon
    // call; the $ prefix span already owns the left-inset slot a leading icon
    // would occupy (presets.ts). Showing the picker there would be a control
    // that visibly does nothing when changed — gated off same as the 5
    // Placeholder-inert types above.
    var iconWrap = document.querySelector('[data-leading-icon-wrap]');
    if (iconWrap) { iconWrap.hidden = acceptFmt === null || (!!node && node.type === 'CurrencyInputQuestion'); }
    if (emptyNote && acceptFmt !== null) { emptyNote.hidden = true; }
    var acceptWrap = document.querySelector('[data-accept-wrap]');
    var acceptSel = document.querySelector('[data-inspector-accept]');
    if (acceptWrap) { acceptWrap.hidden = acceptFmt === null; }
    if (acceptSel && acceptFmt !== null) { acceptSel.value = acceptFmt; }
    var errWrap = document.querySelector('[data-vprop-error-wrap]');
    if (errWrap) { errWrap.hidden = !node || !meta.produces; }

    // R5 D3 (register S4-A3 migration): the copy-node Type swap — MIGRATED
    // from the canvas toolbar. Visible for the 5 TEXT_ROLE_TYPES (moot for a
    // BOUND node: contentVariantOf already hides the whole field-block for
    // those, so this wrap's own hidden state never matters there).
    var typeSwapWrap = document.querySelector('[data-content-typeswap-wrap]');
    if (typeSwapWrap) { typeSwapWrap.hidden = !node || TEXT_ROLE_TYPES.indexOf(node.type) === -1; }
    // R5 D3: searchable-dropdown / card-style / slider-format toggles —
    // MIGRATED from the canvas toolbar's "component" cluster (each SWITCHES
    // the concrete stored component type, the same category as Accept).
    var searchWrap = document.querySelector('[data-toolbar-searchable-wrap]');
    var searchBtn = document.querySelector('[data-toolbar-searchable]');
    var isDropdownSel = !!node && (node.type === 'DropdownQuestion' || node.type === 'SearchableDropdownQuestion');
    if (searchWrap) { searchWrap.hidden = !isDropdownSel; }
    if (searchBtn && isDropdownSel) {
      var searchableNow = node.type === 'SearchableDropdownQuestion';
      searchBtn.textContent = searchableNow ? 'Searchable: on' : 'Searchable: off';
      searchBtn.setAttribute('aria-pressed', searchableNow ? 'true' : 'false');
    }
    var cardStyleWrapContent = document.querySelector('[data-toolbar-card-style-wrap]');
    var curCardStyleContent = cardStyleOf(node);
    if (cardStyleWrapContent) { cardStyleWrapContent.hidden = curCardStyleContent === null; }
    if (curCardStyleContent !== null) {
      var cardBtnsContent = document.querySelectorAll('[data-card-style]');
      var cbic;
      for (cbic = 0; cbic < cardBtnsContent.length; cbic++) {
        cardBtnsContent[cbic].className = cardBtnsContent[cbic].getAttribute('data-card-style') === curCardStyleContent ? 'btn btn-sm btn-secondary active' : 'btn btn-sm btn-outline';
      }
    }
    var sliderWrapContent = document.querySelector('[data-toolbar-slider-format-wrap]');
    var sliderBtnContent = document.querySelector('[data-toolbar-slider-format]');
    var isSliderSel = !!node && (node.type === 'NumberRangeQuestion' || node.type === 'CurrencyRangeQuestion');
    if (sliderWrapContent) { sliderWrapContent.hidden = !isSliderSel; }
    if (sliderBtnContent && isSliderSel) {
      var isCurrencySel = node.type === 'CurrencyRangeQuestion';
      sliderBtnContent.textContent = isCurrencySel ? 'Format $: on' : 'Format $: off';
      sliderBtnContent.setAttribute('aria-pressed', isCurrencySel ? 'true' : 'false');
    }

    // v3.1 R3b E1-C8: Required/When-answered only make sense for a real
    // answer-producing selection — hides for TextBlock/CategoryLabel/
    // HelperText/LegalNote AND AutoAdvanceButton (produces:null), the exact
    // "nonsense controls" the register flagged.
    var behaviorSection = document.querySelector('[data-content-behavior-section]');
    if (behaviorSection) { behaviorSection.hidden = !node || !meta.produces; }

    // v3.1 R3b E2-NEW-10 (studio part): disable Internal field for the 5
    // layout containers (server forbids it outright, container_answer_field_
    // forbidden) with a short human note; every other type keeps the input
    // enabled. computeIssues' own container mirror is R4a's, not this slice's.
    var internalFieldInput = document.getElementById('lg-inspector-internal-field');
    var internalFieldNote = document.querySelector('[data-internal-field-container-note]');
    var isContainerSelection = !!node && meta.container === true;
    if (internalFieldInput) { internalFieldInput.disabled = isContainerSelection; }
    if (internalFieldNote) { internalFieldNote.hidden = !isContainerSelection; }

    // §8.3 Behavior: When-answered segmented (section-wide continue_mode).
    var mode = state.continue_mode || 'button';
    var modeBtns = document.querySelectorAll('[data-set-continue-mode]');
    for (i = 0; i < modeBtns.length; i++) {
      modeBtns[i].className = modeBtns[i].getAttribute('data-set-continue-mode') === mode ? 'active' : '';
    }

    // A6: the image-fit Design control shows ONLY for the image answer grid.
    var fitWrap = document.querySelector('[data-image-fit-wrap]');
    if (fitWrap) { fitWrap.hidden = !node || node.type !== 'ImageCardAnswerGrid'; }

    var fieldEls = document.querySelectorAll('[data-inspector-field]');
    var el, field, val;
    for (i = 0; i < fieldEls.length; i++) {
      el = fieldEls[i];
      field = el.getAttribute('data-inspector-field');
      val = inspectorFieldValue(node, field);
      if (el.type === 'checkbox') { el.checked = !!val; }
      else { el.value = (val === undefined || val === null) ? '' : String(val); }
    }
    var ovEls = document.querySelectorAll('[data-inspector-override]');
    var oval;
    for (i = 0; i < ovEls.length; i++) {
      k = ovEls[i].getAttribute('data-inspector-override');
      oval = (node && node.design_overrides) ? node.design_overrides[k] : undefined;
      // §9.4: a stored legacy #hex needs its appended option before .value.
      if (isHexColor(oval)) { ensureLegacyOption(ovEls[i], String(oval)); }
      ovEls[i].value = (oval === undefined || oval === null) ? '' : String(oval);
    }
    // FIX 4b: dead-write Design rows are GATED per type (overrideRowHidden —
    // columns/gridGap are consumed by renderCardGrid only; iconColor has no
    // consumer on MultiChoiceCardGroup).
    var rowEls = document.querySelectorAll('[data-override-row]');
    var rowKey;
    for (i = 0; i < rowEls.length; i++) {
      rowKey = rowEls[i].getAttribute('data-override-row');
      rowEls[i].hidden = overrideRowHidden(rowKey, node);
    }
    renderOverrideDecorations(node);
    renderPresetControls();
    populateValidation(node, meta);
    populateMapsTab(node, meta);
    populateConditional(node);
    populateRulesAlwaysRow(node);
    populateRequiredWhen(node);
    populateDefaultControls(node);
    populateConnectOffersCard(node);
    var groups = document.querySelectorAll('[data-container-group]');
    for (i = 0; i < groups.length; i++) {
      groups[i].hidden = !node || groups[i].getAttribute('data-container-group') !== node.type;
    }
    populateContainerProps(node);
    populateImageBlockControls(node);
    var choicesBlock = document.querySelector('[data-field-choices-block]');
    if (choicesBlock) { choicesBlock.hidden = !node || meta.choice !== true; }
    var cardStyleHint = document.querySelector('[data-card-style-hint]');
    if (cardStyleHint) { cardStyleHint.hidden = cardStyleOf(node) === null; }
    renderChoiceEditor(node);
    populateChoiceDisplay(node);
    var dbg = document.querySelector('[data-studio-debug-id]');
    if (dbg) { dbg.textContent = node ? node.question_id : ''; }
    // §7.3 Advanced: the bind marker (read-only) — ids/raw markers live here
    // only (§7.4).
    var bindMarker = document.querySelector('[data-studio-bind-marker]');
    if (bindMarker) { bindMarker.textContent = node && node.bind !== undefined ? node.bind : '\\u2014'; }
    var jsonTa = document.getElementById('lg-node-json');
    if (jsonTa) { jsonTa.value = node ? JSON.stringify(node, null, 2) : ''; }
    // §7.3: the raw view re-locks per selection — editing needs the explicit
    // "Edit raw…" confirm again.
    rawEditArmed = false;
    syncRawJsonMode();
    var jsonErr = document.querySelector('[data-studio-node-json-error]');
    if (jsonErr) { jsonErr.hidden = true; }
    var warn = document.querySelector('[data-studio-rename-warning]');
    if (warn) { warn.hidden = true; warn.textContent = ''; }
  }

  // --- inspector collectors ----------------------------------------------------
  function ensureObj(node, key) {
    if (!node[key] || typeof node[key] !== 'object') { node[key] = {}; }
    return node[key];
  }
  function setOrDelete(obj, key, value) {
    if (value === undefined || value === null || value === '') { delete obj[key]; } else { obj[key] = value; }
  }
  function cleanupEmpty(node, key) {
    var o = node[key];
    if (o && typeof o === 'object') {
      var has = false, k;
      for (k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { has = true; break; } }
      if (!has) { delete node[key]; }
    }
  }
  function showRenameWarning(oldField, newField) {
    var el = document.querySelector('[data-studio-rename-warning]');
    if (!el) { return; }
    if (!oldField || newField === oldField) { el.hidden = true; el.textContent = ''; return; }
    // §7.4: the destructive control carries its CONSEQUENCE inline, counted
    // against the live mapping model ("will unlink N Offer mappings").
    var mapCount = 0, mi;
    for (mi = 0; mi < state.answer_maps.length; mi++) {
      if (state.answer_maps[mi] && state.answer_maps[mi].internal_field === oldField) { mapCount += 1; }
    }
    var refs = findConditionalRefs(oldField);
    var msg;
    if (mapCount > 0) {
      msg = 'Renaming the internal field will unlink ' + mapCount + ' Offer mapping' + (mapCount === 1 ? '' : 's') + ' \\u2014 they\\u2019ll need remapping.';
    } else {
      msg = 'Renaming this internal field can break Offer mappings that reference "' + oldField + '" (the mapping panel shows exact usage).';
    }
    if (refs.length > 0) {
      msg += ' ' + refs.length + ' dependency reference(s) still point at it: ' + refs.join(', ') + ' — update them before saving.';
    }
    el.hidden = false;
    el.textContent = msg;
  }
  function collectInspectorField(input) {
    var node = selectedNode();
    if (!node) { return; }
    var field = input.getAttribute('data-inspector-field');
    if (!field) { return; }
    if (field === 'required') { node.required = !!input.checked; }
    else if (field === 'internal_field') {
      var oldField = node.internal_field;
      setOrDelete(node, 'internal_field', input.value);
      showRenameWarning(oldField, trimStr(input.value));
    }
    else if (field === 'question_key') { setOrDelete(node, 'question_key', input.value); }
    else if (field === 'design_preset') { setOrDelete(node, 'design_preset', input.value); }
    else {
      var props = ensureObj(node, 'props');
      if (input.type === 'checkbox') { props[field] = !!input.checked; }
      else if (input.value === '') { delete props[field]; }
      else { props[field] = input.value; }
      cleanupEmpty(node, 'props');
    }
    afterModelChange();
  }
  function collectInspectorOverride(input) {
    var node = selectedNode();
    if (!node) { return; }
    var key = input.getAttribute('data-inspector-override');
    if (!key) { return; }
    var ov = ensureObj(node, 'design_overrides');
    if (input.value === '') { delete ov[key]; }
    else if (key === 'columns') { var n = Number(input.value); ov[key] = isNaN(n) ? input.value : n; }
    else { ov[key] = input.value; }
    cleanupEmpty(node, 'design_overrides');
    afterModelChange();
  }
  function collectValidationProp(input) {
    var node = selectedNode();
    if (!node) { return; }
    var key = input.getAttribute('data-inspector-vprop');
    if (!key) { return; }
    var props = ensureObj(node, 'props');
    if (input.value === '' || (key === 'pattern_preset' && input.value === 'none')) {
      delete props[key];
      if (key === 'pattern_preset') { delete props.pattern; }
    } else if (input.type === 'number') {
      var n = Number(input.value);
      if (isNaN(n)) { delete props[key]; } else { props[key] = n; }
    } else { props[key] = input.value; }
    if (key === 'pattern_preset') {
      var patternIn = document.querySelector('[data-inspector-vprop="pattern"]');
      if (patternIn) { patternIn.hidden = input.value !== 'custom'; }
      if (input.value !== 'custom') { delete props.pattern; }
    }
    cleanupEmpty(node, 'props');
    afterModelChange();
  }
  function populateValidation(node, meta) {
    var list = (meta && meta.validation) ? meta.validation : [];
    var byKey = {};
    var i;
    for (i = 0; i < list.length; i++) { byKey[list[i].key] = list[i].kind; }
    var wraps = document.querySelectorAll('[data-vprop]');
    var k, input, v;
    for (i = 0; i < wraps.length; i++) {
      k = wraps[i].getAttribute('data-vprop');
      if (k === 'pattern') { wraps[i].hidden = !node || node.type !== 'FreeTextQuestion'; continue; }
      wraps[i].hidden = !node || byKey[k] === undefined;
      input = wraps[i].querySelector('[data-inspector-vprop]');
      if (input) {
        input.type = byKey[k] === 'number' ? 'number' : 'text';
        v = (node && node.props) ? node.props[k] : undefined;
        input.value = (v === undefined || v === null) ? '' : String(v);
      }
    }
    // §5.5: the range provider-format note shows for the slider family only.
    var rangeNote = document.querySelector('[data-range-format-note]');
    if (rangeNote) {
      rangeNote.hidden = !node || (node.type !== 'RangeQuestion' && node.type !== 'NumberRangeQuestion' && node.type !== 'CurrencyRangeQuestion');
    }
    var presetSel = document.querySelector('[data-inspector-vprop="pattern_preset"]');
    var patternIn = document.querySelector('[data-inspector-vprop="pattern"]');
    var errIn = document.querySelector('[data-inspector-vprop="error_text"]');
    if (presetSel) { presetSel.value = (node && node.props && node.props.pattern_preset) ? String(node.props.pattern_preset) : 'none'; }
    if (patternIn) {
      patternIn.hidden = !presetSel || presetSel.value !== 'custom';
      patternIn.value = (node && node.props && node.props.pattern) ? String(node.props.pattern) : '';
    }
    if (errIn) { errIn.value = (node && node.props && node.props.error_text) ? String(node.props.error_text) : ''; }
  }

  // --- §9 Maps tab: populate + collect (job-based model, Phase C) -------------
  // Replaces the old flat autofill-oriented panel with the contract's
  // {enabled, jobs:{validate,auction,autocomplete}} shape (content-schema.ts
  // §9.2). The golden's 3 whole-row jobs are the primary controls; R4b
  // (S3-7) reintroduces a per-slot sibling-fill picker — shown only while the
  // autocomplete job is on — writing props.maps.fills.<slot>, the SAME nested
  // shape runtime/maps.ts parseMapsConfig already reads (its fills reader
  // predates this UI producer; mapsConfigJson, presets.ts, stopped discarding
  // the object in the same phase).
  //
  // NOTE on structure: populateMapsTab/collectMapsJob are exercised by
  // leadgen-section-studio-ui.test.ts's studioProbe harness, which slices ONE
  // named function's source text out of the SERVED island (sliceIslandFunction)
  // and runs it in isolation against a small, explicitly-tracked function
  // allowlist (MODEL_FUNCS) — a call to any function NOT on that list
  // ReferenceErrors there even though it exists in the real page. So the
  // fills-picker logic below is INLINED into populateMapsTab/collectMapsJob
  // (never split into a separate helper those two call) — mildly more
  // verbose, but it keeps both functions self-contained for that harness
  // without requiring a change to a file this phase does not own. collectMapsFill
  // is a brand-new handler (not on that list, so nothing there can slice it);
  // it stays self-contained on its own for the same reason.
  function mapsConfigEnabledOf(node) {
    var cfg = mapsConfigOf(node);
    return !!cfg && cfg.enabled === true;
  }
  function mapsJobsOf(node) {
    var cfg = mapsConfigOf(node);
    var jobs = (cfg && cfg.jobs && typeof cfg.jobs === 'object') ? cfg.jobs : {};
    return { validate: jobs.validate === true, auction: jobs.auction === true, autocomplete: jobs.autocomplete === true };
  }
  function mapsAnyJobOn(jobs) { return jobs.validate === true || jobs.auction === true || jobs.autocomplete === true; }
  // §9.1 "Validate the answer" sub-copy is asserted ZIP-specific; Address has
  // no asserted string (FLAGGED contract gap) — a faithful analogous
  // generalization is used for the Address mode.
  function mapsValidateCopyFor(mode) {
    return mode === 'address'
      ? 'Validate the full street address. An incomplete address blocks the Continue button.'
      : 'Allow only valid US ZIP codes. An invalid ZIP blocks the Continue button.';
  }
  function populateMapsTab(node, metaIn) {
    var meta = metaIn || (node ? typeMeta(node.type) : {});
    var mode = meta.maps || null;
    var toggle = document.querySelector('[data-maps-enabled-toggle]');
    var jobsBlock = document.querySelector('[data-maps-jobs-block]');
    var banner = document.querySelector('[data-maps-zero-job-banner]');
    var validateCopy = document.querySelector('[data-maps-validate-copy]');
    var fillsBlock = document.querySelector('[data-maps-fills-block]');
    if (!mode) {
      if (jobsBlock) { jobsBlock.hidden = true; }
      if (toggle) { toggle.checked = false; }
      if (fillsBlock) { fillsBlock.hidden = true; }
      return;
    }
    var enabled = mapsConfigEnabledOf(node);
    var jobs = mapsJobsOf(node);
    if (toggle) { toggle.checked = enabled; }
    if (jobsBlock) { jobsBlock.hidden = !enabled; }
    if (validateCopy) { validateCopy.textContent = mapsValidateCopyFor(mode); }
    var jobEls = document.querySelectorAll('[data-maps-job]');
    var i, k, j, slot, sel, opt, current;
    for (i = 0; i < jobEls.length; i++) {
      k = jobEls[i].getAttribute('data-maps-job');
      jobEls[i].checked = jobs[k] === true;
    }
    // §9.3 "if on and zero jobs selected: amber banner" — a LIVE mirror of
    // the save-time maps_no_job warning (content-schema.ts), computed
    // instantly from the in-memory node so the operator sees it before Save.
    if (banner) { banner.hidden = !(enabled && !mapsAnyJobOn(jobs)); }
    // R4b (S3-6): the plain-words server-key degradation note shows only when
    // the auction job is on — state/city targeting needs the SERVER key;
    // without it the auction facet is ZIP-only.
    var degrade = document.querySelector('[data-maps-degradation-note]');
    if (degrade) { degrade.hidden = !(enabled && jobs.auction === true); }
    // R4b (S3-7): the sibling-fill picker — shown only while autocomplete is
    // on. Populate the 4 per-slot selects from this Section's OTHER
    // internal_field values (self excluded, de-duplicated), pre-selecting
    // each slot's currently stored target.
    var showFills = enabled && jobs.autocomplete === true;
    if (fillsBlock) {
      fillsBlock.hidden = !showFills;
      if (showFills) {
        var selfField = (node && typeof node.internal_field === 'string') ? node.internal_field : '';
        var allFields = internalFieldsOf();
        var others = [];
        for (i = 0; i < allFields.length; i++) {
          if (allFields[i] !== selfField && others.indexOf(allFields[i]) === -1) { others.push(allFields[i]); }
        }
        var cfg = mapsConfigOf(node);
        var fills = (cfg && cfg.fills && typeof cfg.fills === 'object') ? cfg.fills : {};
        var selects = document.querySelectorAll('[data-maps-fill-slot]');
        for (i = 0; i < selects.length; i++) {
          sel = selects[i];
          slot = sel.getAttribute('data-maps-fill-slot');
          current = (typeof fills[slot] === 'string') ? fills[slot] : '';
          sel.innerHTML = '';
          opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'Don’t fill';
          sel.appendChild(opt);
          for (j = 0; j < others.length; j++) {
            opt = document.createElement('option');
            opt.value = others[j];
            opt.textContent = others[j];
            if (others[j] === current) { opt.selected = true; }
            sel.appendChild(opt);
          }
          // A stored target no longer among this Section's fields (the field
          // it named was deleted after being chosen) still shows AS STORED
          // via a synthetic option — honest surfacing, never a silent drop —
          // rather than silently falling back to "Don't fill" while the
          // stale value stays saved underneath (content-schema.ts
          // deliberately performs no dangling-target validation; this is the
          // UI's own honesty check).
          if (current !== '' && others.indexOf(current) === -1) {
            opt = document.createElement('option');
            opt.value = current;
            opt.textContent = current + ' (missing)';
            opt.selected = true;
            sel.appendChild(opt);
          }
        }
      }
    }
  }
  function collectMapsToggle() {
    var node = selectedNode();
    var meta = node ? typeMeta(node.type) : {};
    if (!node || !meta.maps) { return; }
    var toggle = document.querySelector('[data-maps-enabled-toggle]');
    var on = !!toggle && toggle.checked;
    var props = ensureObj(node, 'props');
    if (!on) {
      // Turning the toggle off removes the config entirely (§9.2 — no
      // "enabled:false" residue authored fresh; existing stored
      // enabled:false content still round-trips via the generic path). This
      // also intentionally drops any stored fills (R4b/S3-7) — a fresh
      // re-enable starts blank, exactly like jobs resetting to all-false.
      delete props.maps;
    } else {
      var jobs = mapsJobsOf(node);
      props.maps = { enabled: true, jobs: jobs };
    }
    cleanupEmpty(node, 'props');
    populateMapsTab(node, meta);
    applyCanvasDecoration();
    afterModelChange();
  }
  function collectMapsJob(input) {
    var node = selectedNode();
    var meta = node ? typeMeta(node.type) : {};
    if (!node || !meta.maps) { return; }
    var key = input.getAttribute('data-maps-job');
    if (!key) { return; }
    // Guard BEFORE any mutation: bail out without creating a stray empty
    // props object when the node has no enabled:true config yet (the jobs
    // block is only visible/interactive once the toggle is already on).
    var cfg = mapsConfigOf(node);
    if (!cfg || cfg.enabled !== true) { return; }
    var props = ensureObj(node, 'props');
    var jobs = mapsJobsOf(node);
    jobs[key] = !!input.checked;
    // R4b (S3-7): preserve any already-stored fill targets — toggling
    // validate/auction/autocomplete must never silently wipe a sibling-fill
    // picker choice. Read INLINE off the pre-mutation 'cfg' (not a separate
    // helper — see the NOTE above this section).
    var existingFills = (cfg.fills && typeof cfg.fills === 'object') ? cfg.fills : {};
    var mapsProp = { enabled: true, jobs: jobs };
    if (Object.keys(existingFills).length > 0) { mapsProp.fills = existingFills; }
    props.maps = mapsProp;
    populateMapsTab(node, meta);
    applyCanvasDecoration();
    afterModelChange();
  }
  // R4b (S3-7): one fill-slot select changed — write props.maps.fills.<slot>
  // (or remove that slot on "Don't fill"), preserving the current jobs. A
  // brand-new handler (not referenced by the sibling studioProbe harness'
  // MODEL_FUNCS allowlist), so it is free to be self-contained on its own
  // terms same as every collector above.
  function collectMapsFill(sel) {
    var node = selectedNode();
    var meta = node ? typeMeta(node.type) : {};
    if (!node || !meta.maps) { return; }
    var slot = sel.getAttribute('data-maps-fill-slot');
    if (!slot) { return; }
    // Same before-any-mutation guard as collectMapsJob: the fills block is
    // only visible/interactive once Maps is already enabled.
    var cfg = mapsConfigOf(node);
    if (!cfg || cfg.enabled !== true) { return; }
    var props = ensureObj(node, 'props');
    var jobs = mapsJobsOf(node);
    var fills = (cfg.fills && typeof cfg.fills === 'object') ? cfg.fills : {};
    var next = {}, k;
    for (k in fills) { if (Object.prototype.hasOwnProperty.call(fills, k)) { next[k] = fills[k]; } }
    if (sel.value === '') { delete next[slot]; } else { next[slot] = sel.value; }
    var mapsProp = { enabled: true, jobs: jobs };
    if (Object.keys(next).length > 0) { mapsProp.fills = next; }
    props.maps = mapsProp;
    populateMapsTab(node, meta);
    applyCanvasDecoration();
    afterModelChange();
  }

  // --- §8.5/§8.5b Style tab: Width/Height presets + Custom/Reset, Corners,
  // Border color (field variant); Role (text variant) --------------------------
  // The theme currently PREVIEWED in the bottom drawer (§10.6 "Preview theme"
  // switcher, default Navy) — a Section stores no theme of its own, it always
  // inherits whichever theme renders it, so this is a PREVIEW-CONTEXT label,
  // not a per-node stored value.
  var previewThemeName = 'Navy';
  function populateSizeControls(node) {
    var size = (node && node.design_overrides && node.design_overrides.size) ? node.design_overrides.size : {};
    var widthVal = size.width;
    var isCustomWidth = widthVal !== undefined && typeof widthVal === 'object';
    var customPx = currentCustomWidthPx(node);
    var widthBtns = document.querySelectorAll('[data-set-width]');
    var i;
    for (i = 0; i < widthBtns.length; i++) {
      widthBtns[i].className = (!isCustomWidth && widthVal === widthBtns[i].getAttribute('data-set-width')) ? 'active' : '';
    }
    var customChip = document.querySelector('[data-width-custom-chip]');
    var customLabel = document.querySelector('[data-width-custom-label]');
    if (customChip) { customChip.hidden = !isCustomWidth; }
    if (customLabel && customPx !== null) { customLabel.textContent = 'Custom \\u00b7 \\u2248 ' + customPx + ' px'; }
    var heightVal = size.height;
    // R2 S1-4: height now has the SAME custom/preset duality as width — a
    // custom_px object (from an N/S or corner drag) deselects every height
    // preset and shows the Custom chip + Reset (the width chip's twin).
    var isCustomHeight = heightVal !== undefined && typeof heightVal === 'object';
    var customPxH = currentCustomHeightPx(node);
    var heightBtns = document.querySelectorAll('[data-set-height]');
    for (i = 0; i < heightBtns.length; i++) {
      heightBtns[i].className = (!isCustomHeight && heightVal === heightBtns[i].getAttribute('data-set-height')) ? 'active' : '';
    }
    var heightChip = document.querySelector('[data-height-custom-chip]');
    var heightLabel = document.querySelector('[data-height-custom-label]');
    if (heightChip) { heightChip.hidden = !isCustomHeight; }
    if (heightLabel && customPxH !== null) { heightLabel.textContent = 'Custom \\u00b7 \\u2248 ' + customPxH + ' px'; }
    var themeNote = document.querySelector('[data-style-theme-note]');
    if (themeNote) { themeNote.textContent = 'from theme: ' + previewThemeName; }
  }
  // §7.1 bullet 2: "Selecting a preset writes that preset name to the node and
  // clears any custom value." Reused by BOTH the Style-tab segmented buttons
  // here and — via the same design_overrides.size storage — the Phase-B
  // canvas-drag mechanism (onResizeHandleMouseDown) stays the OTHER writer of
  // the identical key.
  function setWidthPreset(preset) {
    var node = selectedNode();
    if (!node) { return; }
    if (!node.design_overrides) { node.design_overrides = {}; }
    if (!node.design_overrides.size) { node.design_overrides.size = {}; }
    node.design_overrides.size.width = preset;
    populateSizeControls(node);
    applyCanvasDecoration();
    afterModelChange();
  }
  function setHeightPreset(preset) {
    var node = selectedNode();
    if (!node) { return; }
    if (!node.design_overrides) { node.design_overrides = {}; }
    if (!node.design_overrides.size) { node.design_overrides.size = {}; }
    node.design_overrides.size.height = preset;
    populateSizeControls(node);
    // R2 S2-11: a preset REPLACES any height custom_px object, so the canvas
    // custom badge must be re-derived — setWidthPreset already did this; the
    // height twin was the omission the register flagged.
    applyCanvasDecoration();
    afterModelChange();
  }
  // §7.1 bullet 4: "Reset removes the custom value -> the field re-inherits
  // the theme preset." Deletes ONLY the width key (never touches height) —
  // absent = inherit theme default (§7.2).
  function resetWidthCustom() {
    var node = selectedNode();
    if (!node || !node.design_overrides || !node.design_overrides.size) { return; }
    delete node.design_overrides.size.width;
    cleanupEmpty(node.design_overrides, 'size');
    cleanupEmpty(node, 'design_overrides');
    populateSizeControls(node);
    applyCanvasDecoration();
    afterModelChange();
  }
  // R2 S1-4: the height twin of resetWidthCustom — deletes ONLY the height key
  // (never touches width), so the field re-inherits the theme height preset.
  function resetHeightCustom() {
    var node = selectedNode();
    if (!node || !node.design_overrides || !node.design_overrides.size) { return; }
    delete node.design_overrides.size.height;
    cleanupEmpty(node.design_overrides, 'size');
    cleanupEmpty(node, 'design_overrides');
    populateSizeControls(node);
    applyCanvasDecoration();
    afterModelChange();
  }
  // §8.5b Appearance: Corners + Border color — plain enum-scalar
  // design_overrides keys (content-schema.ts CURATED_DESIGN_OVERRIDE_KEYS),
  // never hex. Absent shows the golden fixture's default segment
  // (rounded/neutral) as the VISUAL default — the actual resolved value is a
  // theme concern; no live per-theme default is wired into this admin view.
  function populateCornersBorderControls(node) {
    var corners = (node && node.design_overrides && typeof node.design_overrides.corners === 'string') ? node.design_overrides.corners : 'rounded';
    var borderColor = (node && node.design_overrides && typeof node.design_overrides.border_color === 'string') ? node.design_overrides.border_color : 'neutral';
    var cornersBtns = document.querySelectorAll('[data-set-corners]');
    var i;
    for (i = 0; i < cornersBtns.length; i++) {
      cornersBtns[i].className = cornersBtns[i].getAttribute('data-set-corners') === corners ? 'active' : '';
    }
    var borderBtns = document.querySelectorAll('[data-set-border-color]');
    for (i = 0; i < borderBtns.length; i++) {
      borderBtns[i].className = borderBtns[i].getAttribute('data-set-border-color') === borderColor ? 'active' : '';
    }
    // v3.1 R3 S2-6: paint the (previously empty) role swatches from the resolved
    // theme role colors — the same ROLE_VALUES map the design-panel swatches use.
    var swatches = document.querySelectorAll('[data-border-swatch]');
    var sr, roleKey;
    for (i = 0; i < swatches.length; i++) {
      sr = swatches[i].getAttribute('data-border-swatch');
      roleKey = BORDER_SWATCH_ROLE[sr];
      if (swatches[i].style && roleKey) { swatches[i].style.background = ROLE_VALUES[roleKey] || ''; }
    }
  }
  function setNodeCorners(val) {
    var node = selectedNode();
    if (!node) { return; }
    var overrides = ensureObj(node, 'design_overrides');
    overrides.corners = val;
    populateCornersBorderControls(node);
    // R2 S2-11: re-decorate on corners/border like width already does, so the
    // selection overlay stays measured-accurate after the change re-renders.
    applyCanvasDecoration();
    afterModelChange();
  }
  function setNodeBorderColor(val) {
    var node = selectedNode();
    if (!node) { return; }
    var overrides = ensureObj(node, 'design_overrides');
    overrides.border_color = val;
    populateCornersBorderControls(node);
    applyCanvasDecoration();
    afterModelChange();
  }
  // §8.5b Text/bound-headline Style variant: Role (TextBlock only).
  function populateTextRoleControls(node) {
    var wrap = document.querySelector('[data-text-role-wrap]');
    var sel = document.querySelector('[data-text-block-role]');
    var isTextBlock = !!node && node.type === 'TextBlock';
    if (wrap) { wrap.hidden = !isTextBlock; }
    if (sel && isTextBlock) { sel.value = (node.props && typeof node.props.role === 'string') ? node.props.role : 'body'; }
  }
  // v3.1 R3b deliverable 1 (S2-2 reclassified): REAL resolved values for the
  // read-only Continue Style rows. Color reads the SAME button_primary_bg
  // role renderContinueButton itself falls back to (ROLE_VALUES — the
  // currently-previewed theme's OWN resolved role, computed server-side by
  // the identical resolveTokens() the renderer consumes; sectionRoleValue/
  // per-node overrides can still win at render time, but this IS the honest
  // base the frame/theme actually provides absent those). Position shows the
  // frames.ts schema DEFAULT for section_slot.continue_placement
  // ("inside_unit") — the Studio has no single specific funnel in scope here
  // (a Section may be used by 0/N funnels, each with its own frame), so a
  // per-funnel value cannot be resolved without a new cross-file dependency;
  // showing the documented default (never a fabricated string) plus the
  // "Edit in Quote Builder ->" deep link is the honest resolution. Size has no
  // product-wide config key at all (register SEAM-5) — "Medium (fixed)" is a
  // static, accurate acknowledgment, not a resolved value.
  function populateContinueStyleRows() {
    var colorText = document.querySelector('[data-continue-color-text]');
    if (colorText) {
      var hex = ROLE_VALUES['button_primary_bg'];
      colorText.textContent = (typeof hex === 'string' && hex !== '') ? 'Button (' + hex + ')' : 'Button';
    }
  }
  function collectTextBlockRole() {
    var node = selectedNode();
    if (!node || node.type !== 'TextBlock') { return; }
    var sel = document.querySelector('[data-text-block-role]');
    if (!sel) { return; }
    var props = ensureObj(node, 'props');
    props.role = sel.value;
    afterModelChange();
  }
  // v3.1 R3b deliverable 4: the ImageBlock source toggle — writes props.source
  // (media|auto_logo) and re-populates so the media-vs-auto_logo sub-sections
  // swap immediately.
  function setImageBlockSource(value) {
    var node = selectedNode();
    if (!node || node.type !== 'ImageBlock') { return; }
    var props = ensureObj(node, 'props');
    props.source = value;
    populateImageBlockControls(node);
    afterModelChange();
  }

  // --- §8.6 Rules tab: "Always show" default / revealed condition builder -----
  // rulesFieldsRevealed is a UI-ONLY toggle (independent of the stored
  // conditional) so "+ Add a condition" can open the picker fieldset BEFORE
  // any field is chosen; it re-locks to the stored state on every new
  // selection ("collapsed/always-show by default" — matching the Advanced
  // disclosure's per-selection re-lock doctrine).
  var rulesFieldsRevealed = false;
  function renderRulesFieldsVisibility(show) {
    var row = document.querySelector('[data-rules-always-row]');
    var fields = document.querySelector('[data-rules-condition-fields]');
    var addBtn = document.querySelector('[data-rules-add-condition]');
    var removeBtn = document.querySelector('[data-rules-remove-condition]');
    if (row) { row.hidden = show; }
    if (fields) { fields.hidden = !show; }
    if (addBtn) { addBtn.hidden = show; }
    if (removeBtn) { removeBtn.hidden = !show; }
  }
  function populateRulesAlwaysRow(node) {
    var hasCond = !!(node && node.conditional && node.conditional.when);
    rulesFieldsRevealed = hasCond;
    renderRulesFieldsVisibility(hasCond);
  }

  // --- §8.3 Connect-to-Offers green card (Content tab, field variant) ---------
  // "This answer fills <field> on all N Offers." — read-only, computed from
  // the SAME mapping data the Offers tab renders (offersList/edgesForOffer/
  // answerFieldOf); "all N" only when EVERY selected Offer maps this field.
  function populateConnectOffersCard(node) {
    var card = document.querySelector('[data-connect-offers-card]');
    var textEl = document.querySelector('[data-connect-offers-text]');
    if (!card) { return; }
    if (!node || !node.internal_field || !offersData) { card.hidden = true; return; }
    var list = offersList();
    var selected = [], i, offer, live;
    for (i = 0; i < list.length; i++) {
      offer = list[i];
      live = offerLiveState(offer);
      if (live.state !== 'not_selected') { selected.push(offer); }
    }
    if (selected.length === 0) { card.hidden = true; return; }
    var mappedCount = 0, fieldLabel = '', j, edges, e, f;
    for (i = 0; i < selected.length; i++) {
      edges = edgesForOffer(selected[i].id);
      for (j = 0; j < edges.length; j++) {
        e = edges[j];
        if (e.internal_field === node.internal_field) {
          mappedCount += 1;
          if (fieldLabel === '') {
            f = answerFieldOf(selected[i], e.offer_payload_field_path);
            fieldLabel = f ? fieldDisplayLabel(f) : e.offer_payload_field_path;
          }
          break;
        }
      }
    }
    if (mappedCount === 0) { card.hidden = true; return; }
    card.hidden = false;
    if (textEl) {
      clearChildren(textEl);
      textEl.appendChild(document.createTextNode('This answer fills '));
      var b = document.createElement('b');
      b.appendChild(document.createTextNode(fieldLabel || node.internal_field));
      textEl.appendChild(b);
      textEl.appendChild(document.createTextNode(
        mappedCount === selected.length
          ? (' on all ' + selected.length + ' Offer' + (selected.length === 1 ? '' : 's') + '.')
          : (' on ' + mappedCount + ' of ' + selected.length + ' Offers.')
      ));
    }
  }

  // --- §8.5 container prop collectors -------------------------------------------
  // Line-based PAIR props ("left|right" per line → [{leftKey, rightKey}]):
  // FooterBar links label|href, TrustBar items icon|text, LogoStrip logos
  // mediaId|alt. A line without '|' fills only the single-required side
  // (items: text-only row; logos: mediaId-only row); links REQUIRE both.
  // The spec table lives INSIDE each function so the vm-probe slices stay
  // self-contained (MODEL_FUNCS slicing contract).
  function setLinesProp(props, key, raw) {
    var pairSpecs = {
      links: { left: 'label', right: 'href', bare: null },
      items: { left: 'icon', right: 'text', bare: 'text' },
      logos: { left: 'mediaId', right: 'alt', bare: 'mediaId' }
    };
    var pair = pairSpecs[key] || null;
    var lines = String(raw || '').split('\\n');
    var out = [], i, t, at, left, right, row;
    for (i = 0; i < lines.length; i++) {
      t = trimStr(lines[i]);
      if (t === '') { continue; }
      if (pair) {
        at = t.indexOf('|');
        if (at === -1) {
          if (!pair.bare) { continue; } // links: both sides required
          row = {};
          row[pair.bare] = t;
          out.push(row);
          continue;
        }
        left = trimStr(t.slice(0, at));
        right = trimStr(t.slice(at + 1));
        if (left === '' && pair.bare === pair.right) {
          // items "|text": icon omitted → text-only trust item
          if (right === '') { continue; }
          row = {};
          row[pair.right] = right;
          out.push(row);
          continue;
        }
        if (left === '' && pair.bare === pair.left) { continue; } // logos: mediaId required
        row = {};
        row[pair.left] = left;
        row[pair.right] = right;
        out.push(row);
      } else { out.push(t); }
    }
    if (out.length > 0) { props[key] = out; } else { delete props[key]; }
  }
  function linesValue(key, v) {
    var pairSpecs = {
      links: { left: 'label', right: 'href', bare: null },
      items: { left: 'icon', right: 'text', bare: 'text' },
      logos: { left: 'mediaId', right: 'alt', bare: 'mediaId' }
    };
    var pair = pairSpecs[key] || null;
    if (!v || !v.length) { return ''; }
    var out = [], i, left, right;
    for (i = 0; i < v.length; i++) {
      if (pair) {
        left = v[i] && v[i][pair.left] !== undefined && v[i][pair.left] !== null ? String(v[i][pair.left]) : '';
        right = v[i] && v[i][pair.right] !== undefined && v[i][pair.right] !== null ? String(v[i][pair.right]) : '';
        if (pair.bare === pair.right && left === '') { out.push(right); }
        else if (pair.bare === pair.left && right === '') { out.push(left); }
        else { out.push(left + '|' + right); }
      } else { out.push(String(v[i])); }
    }
    return out.join('\\n');
  }
  function collectContainerProp(input) {
    var node = selectedNode();
    if (!node) { return; }
    var key = input.getAttribute('data-container-prop');
    if (!key) { return; }
    var kind = input.getAttribute('data-container-kind') || (input.type === 'checkbox' ? 'bool' : 'text');
    var props = ensureObj(node, 'props');
    if (input.type === 'checkbox') {
      if (input.checked) { props[key] = true; } else { delete props[key]; }
    } else if (kind === 'int') {
      var n = Number(input.value);
      if (input.value === '' || isNaN(n)) { delete props[key]; }
      else {
        // StepIndicator numeric contract (§8.6): steps/current are integers
        // >= 1 and current never exceeds steps — the island mirrors the
        // preset's defensive clamp so the SAVED model is already valid.
        if (node.type === 'StepIndicator') {
          n = Math.max(1, Math.round(n));
          if (key === 'current' && typeof props.steps === 'number' && n > props.steps) { n = props.steps; }
          if (key === 'steps' && typeof props.current === 'number' && props.current > n) { props.current = n; }
          if (String(n) !== String(input.value)) { input.value = String(n); }
        }
        props[key] = n;
      }
    } else if (kind === 'lines') {
      setLinesProp(props, key, input.value);
    } else {
      setOrDelete(props, key, input.value);
    }
    cleanupEmpty(node, 'props');
    afterModelChange();
  }
  function collectContainerCta() {
    var node = selectedNode();
    if (!node) { return; }
    var labelEl = document.querySelector('[data-container-cta="label"]');
    var telEl = document.querySelector('[data-container-cta="tel"]');
    var hrefEl = document.querySelector('[data-container-cta="href"]');
    var label = labelEl ? trimStr(labelEl.value) : '';
    var tel = telEl ? trimStr(telEl.value) : '';
    var href = hrefEl ? trimStr(hrefEl.value) : '';
    var props = ensureObj(node, 'props');
    if (label === '' || (tel === '' && href === '')) { delete props.cta; }
    else {
      var cta = { label: label };
      if (href !== '') { cta.href = href; } else { cta.tel = tel; }
      props.cta = cta;
    }
    cleanupEmpty(node, 'props');
    afterModelChange();
  }
  function populateContainerProps(node) {
    var inputs = document.querySelectorAll('[data-container-prop]');
    var i, k, v;
    for (i = 0; i < inputs.length; i++) {
      k = inputs[i].getAttribute('data-container-prop');
      v = (node && node.props) ? node.props[k] : undefined;
      if (inputs[i].type === 'checkbox') { inputs[i].checked = v === true; }
      else if (inputs[i].getAttribute('data-container-kind') === 'lines') { inputs[i].value = linesValue(k, v); }
      else { inputs[i].value = (v === undefined || v === null) ? '' : String(v); }
    }
    var ctas = document.querySelectorAll('[data-container-cta]');
    var cta = (node && node.props && node.props.cta && typeof node.props.cta === 'object') ? node.props.cta : {};
    for (i = 0; i < ctas.length; i++) {
      k = ctas[i].getAttribute('data-container-cta');
      ctas[i].value = (cta[k] === undefined || cta[k] === null) ? '' : String(cta[k]);
    }
  }
  // v3.1 R3b deliverable 4 (E2-NEW-1): ImageBlock's dedicated Content-tab
  // block — gate visibility, sync the source segmented control + the
  // media-vs-auto_logo sub-sections, and refresh the thumbnail from the
  // CURRENT logoMediaId value (the generic data-inspector-field loop already
  // populated the underlying input's .value before this runs).
  function populateImageBlockControls(node) {
    var block = document.querySelector('[data-content-imageblock-block]');
    var isImageBlock = !!node && node.type === 'ImageBlock';
    if (block) { block.hidden = !isImageBlock; }
    if (!isImageBlock) { return; }
    var source = (node.props && node.props.source === 'auto_logo') ? 'auto_logo' : 'media';
    var btns = document.querySelectorAll('[data-set-imageblock-source]');
    var i;
    for (i = 0; i < btns.length; i++) {
      btns[i].className = btns[i].getAttribute('data-set-imageblock-source') === source ? 'active' : '';
    }
    var mediaFields = document.querySelector('[data-imageblock-media-fields]');
    var autoLogoNote = document.querySelector('[data-imageblock-autologo-note]');
    if (mediaFields) { mediaFields.hidden = source !== 'media'; }
    if (autoLogoNote) { autoLogoNote.hidden = source !== 'auto_logo'; }
    var thumb = document.querySelector('[data-imageblock-thumb]');
    var mediaInput = document.getElementById('lg-imageblock-media');
    if (thumb && mediaInput) { setChoiceThumb(thumb, mediaInput.value); }
  }

  // --- dependencies (§6.10 typed IF/THEN builder) --------------------------------
  function typedScalar(raw, refType) {
    if (refType === 'boolean') { return raw === 'true' || raw === true; }
    if (refType === 'number' || refType === 'currency') {
      var n = Number(raw);
      return isNaN(n) ? raw : n;
    }
    return raw;
  }
  function splitTypedList(raw, refType) {
    var parts = String(raw || '').split(',');
    var out = [], i, t;
    for (i = 0; i < parts.length; i++) {
      t = trimStr(parts[i]);
      if (t !== '') { out.push(typedScalar(t, refType)); }
    }
    return out;
  }
  function buildConditional(when, op, parts, refType) {
    if (!when) { return null; }
    var cond = { when: when, op: op || 'eq' };
    if (cond.op === 'range') { cond.from = Number(parts.from); cond.to = Number(parts.to); }
    else if (cond.op === 'in' || cond.op === 'not_in') { cond.values = splitTypedList(parts.values, refType); }
    else { cond.value = typedScalar(parts.value, refType); }
    return cond;
  }
  function readCond(key) {
    var el = document.querySelector('[data-inspector-cond="' + key + '"]');
    return el ? el.value : '';
  }
  function condPartValue(info, op) {
    if (op === 'range' || op === 'in' || op === 'not_in') { return ''; }
    if (info.type === 'boolean') { return readCond('value-bool'); }
    if (info.choices && (op === 'eq' || op === 'neq')) { return readCond('value-enum'); }
    return readCond('value');
  }
  function updateCondValueInputs(node) {
    var whenSel = document.querySelector('[data-inspector-cond="when"]');
    var opSel = document.querySelector('[data-inspector-cond="op"]');
    var boolSel = document.querySelector('[data-inspector-cond="value-bool"]');
    var enumSel = document.querySelector('[data-inspector-cond="value-enum"]');
    var valIn = document.querySelector('[data-inspector-cond="value"]');
    var fromIn = document.querySelector('[data-inspector-cond="from"]');
    var toIn = document.querySelector('[data-inspector-cond="to"]');
    var valuesIn = document.querySelector('[data-inspector-cond="values"]');
    if (!whenSel || !opSel) { return; }
    var op = opSel.value || 'eq';
    var info = refFieldInfo(whenSel.value);
    var cond = (node && node.conditional) ? node.conditional : {};
    var isRange = op === 'range';
    var isList = op === 'in' || op === 'not_in';
    var scalarKind = 'text';
    if (!isRange && !isList) {
      if (info.type === 'boolean') { scalarKind = 'bool'; }
      else if (info.choices && (op === 'eq' || op === 'neq')) { scalarKind = 'enum'; }
    }
    if (boolSel) {
      boolSel.hidden = scalarKind !== 'bool';
      boolSel.value = cond.value === false ? 'false' : 'true';
    }
    if (enumSel) {
      enumSel.hidden = scalarKind !== 'enum';
      clearChildren(enumSel);
      var i, o;
      if (info.choices) {
        for (i = 0; i < info.choices.length; i++) {
          o = document.createElement('option');
          o.value = String(info.choices[i].value);
          o.textContent = String(info.choices[i].label || info.choices[i].value);
          enumSel.appendChild(o);
        }
      }
      if (scalarKind === 'enum' && cond.value !== undefined && cond.value !== null) { enumSel.value = String(cond.value); }
    }
    if (valIn) {
      valIn.hidden = isRange || isList || scalarKind !== 'text';
      valIn.value = (cond.value === undefined || cond.value === null) ? '' : String(cond.value);
    }
    if (fromIn) { fromIn.hidden = !isRange; fromIn.value = (cond.from === undefined) ? '' : String(cond.from); }
    if (toIn) { toIn.hidden = !isRange; toIn.value = (cond.to === undefined) ? '' : String(cond.to); }
    if (valuesIn) {
      valuesIn.hidden = !isList;
      valuesIn.value = (cond.values && cond.values.length) ? cond.values.join(', ') : '';
    }
  }
  function populateConditional(node) {
    var whenSel = document.querySelector('[data-inspector-cond="when"]');
    var opSel = document.querySelector('[data-inspector-cond="op"]');
    if (!whenSel || !opSel) { return; }
    clearChildren(whenSel);
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '\\u2014 always visible \\u2014';
    whenSel.appendChild(opt);
    var fields = internalFieldsOf();
    var i, eligible = 0;
    for (i = 0; i < fields.length; i++) {
      if (node && node.internal_field && fields[i] === node.internal_field) { continue; }
      opt = document.createElement('option');
      opt.value = fields[i];
      opt.textContent = fields[i];
      whenSel.appendChild(opt);
      eligible += 1;
    }
    // R4a S3-1: zero eligible sources (self-excluded, or the section has no
    // other question yet) — plain words replace the bare dropdown.
    var emptyHint = document.querySelector('[data-rules-source-empty-hint]');
    if (emptyHint) { emptyHint.hidden = eligible > 0; }
    whenSel.hidden = eligible === 0;
    var cond = (node && node.conditional) ? node.conditional : null;
    whenSel.value = (cond && cond.when) ? cond.when : '';
    opSel.value = (cond && cond.op) ? cond.op : 'eq';
    updateCondValueInputs(node);
  }
  function collectConditional() {
    var node = selectedNode();
    if (!node) { return; }
    var whenSel = document.querySelector('[data-inspector-cond="when"]');
    var opSel = document.querySelector('[data-inspector-cond="op"]');
    if (!whenSel || !opSel) { return; }
    var whenVal = trimStr(whenSel.value);
    var op = opSel.value || 'eq';
    var info = refFieldInfo(whenVal);
    var parts = {
      value: condPartValue(info, op),
      values: readCond('values'),
      from: readCond('from'),
      to: readCond('to')
    };
    var cond = buildConditional(whenVal, op, parts, info.type);
    if (cond === null) { delete node.conditional; } else { node.conditional = cond; }
    updateCondValueInputs(node);
    renderConditionSentences(node);
    afterModelChange();
  }

  // --- FIX 7: "Require this component IF" — props.requiredWhen -------------------
  // The runtime already consumes props.requiredWhen (runtime/dependencies.ts
  // requiredNow + the server twin) — these rows are the authoring side. The
  // SAME typed IF builder (buildConditional) produces the SAME conditional
  // shape; the pickers stay the controls, the sentence is the readable text.
  function readReqCond(key) {
    var el = document.querySelector('[data-inspector-reqcond="' + key + '"]');
    return el ? el.value : '';
  }
  function reqCondPartValue(info, op) {
    if (op === 'range' || op === 'in' || op === 'not_in') { return ''; }
    if (info.type === 'boolean') { return readReqCond('value-bool'); }
    if (info.choices && (op === 'eq' || op === 'neq')) { return readReqCond('value-enum'); }
    return readReqCond('value');
  }
  function nodeRequiredWhen(node) {
    if (!node || !node.props || !node.props.requiredWhen || typeof node.props.requiredWhen !== 'object') { return null; }
    return node.props.requiredWhen;
  }
  function updateReqCondValueInputs(node) {
    var whenSel = document.querySelector('[data-inspector-reqcond="when"]');
    var opSel = document.querySelector('[data-inspector-reqcond="op"]');
    var boolSel = document.querySelector('[data-inspector-reqcond="value-bool"]');
    var enumSel = document.querySelector('[data-inspector-reqcond="value-enum"]');
    var valIn = document.querySelector('[data-inspector-reqcond="value"]');
    var fromIn = document.querySelector('[data-inspector-reqcond="from"]');
    var toIn = document.querySelector('[data-inspector-reqcond="to"]');
    var valuesIn = document.querySelector('[data-inspector-reqcond="values"]');
    if (!whenSel || !opSel) { return; }
    var op = opSel.value || 'eq';
    var info = refFieldInfo(whenSel.value);
    var cond = nodeRequiredWhen(node) || {};
    var isRange = op === 'range';
    var isList = op === 'in' || op === 'not_in';
    var scalarKind = 'text';
    if (!isRange && !isList) {
      if (info.type === 'boolean') { scalarKind = 'bool'; }
      else if (info.choices && (op === 'eq' || op === 'neq')) { scalarKind = 'enum'; }
    }
    if (boolSel) {
      boolSel.hidden = scalarKind !== 'bool';
      boolSel.value = cond.value === false ? 'false' : 'true';
    }
    if (enumSel) {
      enumSel.hidden = scalarKind !== 'enum';
      clearChildren(enumSel);
      var i, o;
      if (info.choices) {
        for (i = 0; i < info.choices.length; i++) {
          o = document.createElement('option');
          o.value = String(info.choices[i].value);
          o.textContent = String(info.choices[i].label || info.choices[i].value);
          enumSel.appendChild(o);
        }
      }
      if (scalarKind === 'enum' && cond.value !== undefined && cond.value !== null) { enumSel.value = String(cond.value); }
    }
    if (valIn) {
      valIn.hidden = isRange || isList || scalarKind !== 'text';
      valIn.value = (cond.value === undefined || cond.value === null) ? '' : String(cond.value);
    }
    if (fromIn) { fromIn.hidden = !isRange; fromIn.value = (cond.from === undefined) ? '' : String(cond.from); }
    if (toIn) { toIn.hidden = !isRange; toIn.value = (cond.to === undefined) ? '' : String(cond.to); }
    if (valuesIn) {
      valuesIn.hidden = !isList;
      valuesIn.value = (cond.values && cond.values.length) ? cond.values.join(', ') : '';
    }
  }
  function populateRequiredWhen(node) {
    var wrap = document.querySelector('[data-reqcond-wrap]');
    var meta = node ? typeMeta(node.type) : {};
    // requiredWhen is meaningful for answer-PRODUCING components only.
    if (wrap) { wrap.hidden = !node || !meta.produces; }
    var whenSel = document.querySelector('[data-inspector-reqcond="when"]');
    var opSel = document.querySelector('[data-inspector-reqcond="op"]');
    if (!whenSel || !opSel) { return; }
    clearChildren(whenSel);
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '\\u2014 only when marked Required \\u2014';
    whenSel.appendChild(opt);
    var fields = internalFieldsOf();
    var i, eligible = 0;
    for (i = 0; i < fields.length; i++) {
      if (node && node.internal_field && fields[i] === node.internal_field) { continue; }
      opt = document.createElement('option');
      opt.value = fields[i];
      opt.textContent = fields[i];
      whenSel.appendChild(opt);
      eligible += 1;
    }
    // R4a S3-1 (mirrored): same dead-end, same fix.
    var reqEmptyHint = document.querySelector('[data-reqcond-source-empty-hint]');
    if (reqEmptyHint) { reqEmptyHint.hidden = eligible > 0; }
    whenSel.hidden = eligible === 0;
    var cond = nodeRequiredWhen(node);
    whenSel.value = (cond && cond.when) ? cond.when : '';
    opSel.value = (cond && cond.op) ? cond.op : 'eq';
    updateReqCondValueInputs(node);
    renderConditionSentences(node);
  }
  function collectRequiredWhen() {
    var node = selectedNode();
    if (!node) { return; }
    var whenSel = document.querySelector('[data-inspector-reqcond="when"]');
    var opSel = document.querySelector('[data-inspector-reqcond="op"]');
    if (!whenSel || !opSel) { return; }
    var whenVal = trimStr(whenSel.value);
    var op = opSel.value || 'eq';
    var info = refFieldInfo(whenVal);
    var parts = {
      value: reqCondPartValue(info, op),
      values: readReqCond('values'),
      from: readReqCond('from'),
      to: readReqCond('to')
    };
    var cond = buildConditional(whenVal, op, parts, info.type);
    var props = ensureObj(node, 'props');
    if (cond === null) { delete props.requiredWhen; } else { props.requiredWhen = cond; }
    cleanupEmpty(node, 'props');
    updateReqCondValueInputs(node);
    renderConditionSentences(node);
    afterModelChange();
  }

  // §7.3 sentence pattern: the row's READABLE text — "Show this question when
  // <field> is <value>" — rendered from the stored conditional; the pickers
  // stay the controls.
  function conditionSentence(prefix, cond) {
    // R4a S3-2: the SAME human-word table the SSR operator <select> renders
    // (CONDITION_OP_LABELS, TS-side, ui-section-studio.ts) — interpolated
    // here as data so the dropdown and this sentence never drift apart.
    // Declared LOCAL (not a module-level var) so this vm-probed function
    // (test/leadgen-section-studio-ui.test.ts slices it standalone by
    // name) stays fully self-contained — a module-level var would not
    // travel with a function-only slice.
    var CONDITION_OP_LABELS = ${JSON.stringify(CONDITION_OP_LABELS)};
    var field = cond.when;
    var op = cond.op || 'eq';
    var label = CONDITION_OP_LABELS[op] || op;
    if (op === 'range') { return prefix + ' when ' + field + ' is ' + label + ' ' + String(cond.from) + ' and ' + String(cond.to); }
    if (op === 'in' || op === 'not_in') { return prefix + ' when ' + field + ' is ' + label + ': ' + (cond.values || []).join(', '); }
    var rel = (op === 'eq' || op === 'neq') ? label : ('is ' + label);
    return prefix + ' when ' + field + ' ' + rel + ' ' + String(cond.value);
  }
  function renderConditionSentences(node) {
    var showEl = document.querySelector('[data-cond-sentence]');
    var reqEl = document.querySelector('[data-reqcond-sentence]');
    var cond = (node && node.conditional) ? node.conditional : null;
    var rw = nodeRequiredWhen(node);
    if (showEl) {
      showEl.textContent = (cond && cond.when) ? conditionSentence('Show this question', cond) : 'This question is always shown.';
    }
    if (reqEl) {
      if (rw && rw.when) { reqEl.textContent = conditionSentence('Require this question', rw); }
      else if (node && node.required === true) { reqEl.textContent = 'This question is always required (Validation tab).'; }
      else { reqEl.textContent = 'No requirement condition \\u2014 add one below.'; }
    }
  }

  // --- §5.5 defaults (FIX 8a/8b) --------------------------------------------------
  // yes/no → props.defaultValue (boolean) — the config-dto default_answer /
  // runtime default_applied path; the visitor still confirms it (§5.5).
  // range → props.default (number); dropdowns → props.default (choice value)
  // — both consumed by the presets (renderRange / the dropdown renderers).
  var RANGE_DEFAULT_TYPES = ['RangeQuestion', 'CurrencyRangeQuestion', 'NumberRangeQuestion'];
  var DROPDOWN_DEFAULT_TYPES = ['DropdownQuestion', 'SearchableDropdownQuestion'];
  function defaultKindOf(node) {
    if (!node) { return null; }
    if (node.type === 'TwoButtonYesNo') { return 'yesno'; }
    if (RANGE_DEFAULT_TYPES.indexOf(node.type) !== -1) { return 'range'; }
    if (DROPDOWN_DEFAULT_TYPES.indexOf(node.type) !== -1) { return 'dropdown'; }
    return null;
  }
  function populateDefaultControls(node) {
    var kind = defaultKindOf(node);
    var wraps = document.querySelectorAll('[data-default-wrap]');
    var i, w;
    for (i = 0; i < wraps.length; i++) {
      w = wraps[i].getAttribute('data-default-wrap');
      wraps[i].hidden = w !== kind;
    }
    if (kind === null) { return; }
    var props = node.props || {};
    var el;
    if (kind === 'yesno') {
      el = document.querySelector('[data-default-control="yesno"]');
      if (el) { el.value = props.defaultValue === true ? 'true' : (props.defaultValue === false ? 'false' : ''); }
      return;
    }
    if (kind === 'range') {
      el = document.querySelector('[data-default-control="range"]');
      if (el) { el.value = typeof props.default === 'number' ? String(props.default) : ''; }
      return;
    }
    el = document.querySelector('[data-default-control="dropdown"]');
    if (!el) { return; }
    clearChildren(el);
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No default \\u2014 the visitor picks';
    el.appendChild(opt);
    var choices = node.choices || [];
    for (i = 0; i < choices.length; i++) {
      if (!choices[i]) { continue; }
      opt = document.createElement('option');
      opt.value = String(choices[i].value);
      opt.textContent = String(choices[i].label || choices[i].value);
      el.appendChild(opt);
    }
    el.value = (props.default === undefined || props.default === null) ? '' : String(props.default);
  }
  function collectDefaultControl(input) {
    var node = selectedNode();
    if (!node) { return; }
    var kind = input.getAttribute('data-default-control');
    if (kind !== defaultKindOf(node)) { return; }
    var props = ensureObj(node, 'props');
    var v = trimStr(input.value);
    if (kind === 'yesno') {
      if (v === '') { delete props.defaultValue; }
      else { props.defaultValue = v === 'true'; }
    } else if (kind === 'range') {
      var n = Number(v);
      if (v === '' || isNaN(n)) { delete props.default; }
      else { props.default = n; }
    } else {
      if (v === '') { delete props.default; }
      else { props.default = v; }
    }
    cleanupEmpty(node, 'props');
    afterModelChange();
  }

  // --- choices editor (§8.6: rows + main/Other grouping + bulk paste) -----------
  // A5: image_alt rides the row editor so an image-grid choice edit PRESERVES
  // the §8.4-required alt (collectChoices rebuilds each choice from the row
  // inputs — a field missing here would be silently dropped). Wave 2 owns the
  // full §7.3 Choices-depth grid (title/subtitle/badge/emoji/picker cells).
  // §7.3 Choices tab rows — SECTION-OWNED fields ONLY (C1): display label,
  // internal normalized value (auto-suggested from the label), analytics
  // label, icon/emoji (mutually exclusive), image + REQUIRED alt (media
  // picker cell), title/subtitle/badge, aria_label, disabled, main/Other
  // grouping, reorder. There is NO provider-value control here — each row
  // ends with the read-only "Provider values: k/n Offers" chip (§12.2).
  var CHOICE_FIELDS = ['label', 'value', 'analytics_id', 'title', 'subtitle', 'badge', 'icon', 'emoji', 'imageMediaId', 'image_alt', 'aria_label', 'description'];
  // §12.4: placeholders are operator copy — raw storage keys never surface.
  var CHOICE_FIELD_PLACEHOLDERS = { analytics_id: 'Analytics label (auto)', imageMediaId: 'Image URL', image_alt: 'Image alt text', aria_label: 'Screen-reader label' };
  // v3.1 R3 S2-4/E1-NEW-2: visible column LABELS (register: "Label / Saved value
  // / Analytics ID" for the three primary columns; the rest labeled for parity).
  var CHOICE_FIELD_LABELS = { label: 'Label', value: 'Saved value', analytics_id: 'Analytics ID', title: 'Title', subtitle: 'Subtitle', badge: 'Badge', icon: 'Icon', emoji: 'Emoji', imageMediaId: 'Image', image_alt: 'Image alt', aria_label: 'Screen-reader label', description: 'Description' };
  // v3.1 R3 E1-NEW-2: the per-type VISIBLE choice fields, DERIVED from which
  // fields each renderer consumes (presets.ts) — the same discipline as the size
  // pin. A vitest set-equality pin (test/leadgen-r3a-choice-fields.test.ts)
  // re-derives this from presets.ts source so future drift fails. BAG/DDQ/SDQ/OGS
  // consume only label/value/analytics_id; MCG adds title/subtitle; the two card
  // grids consume every field (renderCardGrid references all 12).
  var CHOICE_FIELD_CONSUMPTION = {
    ButtonAnswerGroup: ['label', 'value', 'analytics_id'],
    DropdownQuestion: ['label', 'value', 'analytics_id'],
    SearchableDropdownQuestion: ['label', 'value', 'analytics_id'],
    OtherGroupSelector: ['label', 'value', 'analytics_id'],
    MultiChoiceCardGroup: ['label', 'value', 'analytics_id', 'title', 'subtitle'],
    IconCardAnswerGrid: CHOICE_FIELDS,
    ImageCardAnswerGrid: CHOICE_FIELDS
  };
  function choiceFieldsFor(node) {
    var f = node ? CHOICE_FIELD_CONSUMPTION[node.type] : null;
    return f || CHOICE_FIELDS;
  }
  // v3.1 R3 S2-5: curated emoji palette (human choice, not a bare text input).
  var CHOICE_EMOJI_PALETTE = ['\\u2705', '\\u274C', '\\u2B50', '\\uD83D\\uDD25', '\\uD83D\\uDC4D', '\\uD83D\\uDC4E', '\\u2764\\uFE0F', '\\uD83C\\uDFE0', '\\uD83D\\uDE97', '\\uD83D\\uDCB0', '\\uD83D\\uDCC5', '\\uD83D\\uDCDE', '\\uD83D\\uDCE7', '\\uD83D\\uDD12', '\\uD83D\\uDC64', '\\uD83D\\uDEE1\\uFE0F'];
  // v3.1 R3 S2-5/6c: the icon picker reuses the SAME 12 §8.1 leading-icon options.
  var CHOICE_ICON_OPTIONS = studioMeta.leading_icons || [];
  function choiceContainer() { return document.querySelector('[data-inspector-choices]'); }
  // §6.4 "internal-value chip" + §12.2 chip: one row per SELECTED Offer with
  // that Offer's provider value or "not set", deep-linking into the Offer's
  // value map. Read-only by construction.
  function buildProviderChip(node, choice) {
    var wrap = document.createElement('span');
    wrap.setAttribute('data-choice-provider', '');
    var internalField = node && node.internal_field ? String(node.internal_field) : '';
    var value = choice && choice.value !== undefined ? String(choice.value) : '';
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'studio-provider-chip';
    chip.setAttribute('data-choice-provider-chip', value);
    chip.appendChild(document.createTextNode(providerChipLabel(internalField, value)));
    wrap.appendChild(chip);
    var rowsEl = document.createElement('div');
    rowsEl.className = 'studio-provider-rows';
    rowsEl.setAttribute('data-choice-provider-rows', value);
    rowsEl.hidden = true;
    var rows = providerChipRows(internalField, value);
    // R4a S2-10: "0/0 Offers" reads as broken without this — plain words on
    // why it's 0/0 and what makes it move (native tooltip; the chip stays a
    // real, clickable control either way).
    chip.title = rows.length === 0
      ? 'Counts fill in after you select Offers for this section and map this field\\u2019s values on the Offer\\u2019s payload page.'
      : 'Provider values set for ' + rows.length + ' selected Offer' + (rows.length === 1 ? '' : 's') + ' \\u2014 click to see each one.';
    var i, line, a;
    if (rows.length === 0) {
      line = document.createElement('div');
      line.appendChild(document.createTextNode('No Offers selected yet \\u2014 select Offers in the mapping drawer first.'));
      rowsEl.appendChild(line);
    }
    for (i = 0; i < rows.length; i++) {
      line = document.createElement('div');
      line.setAttribute('data-provider-offer', rows[i].offer_public_id || '');
      line.appendChild(document.createTextNode(rows[i].offer_name + ': ' + (rows[i].value === null ? 'not set' : rows[i].value) + ' '));
      if (rows[i].href !== null) {
        a = document.createElement('a');
        a.href = rows[i].href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.setAttribute('data-provider-valuemap-link', rows[i].offer_public_id || '');
        a.appendChild(document.createTextNode('Open value map'));
        line.appendChild(a);
      }
      rowsEl.appendChild(line);
    }
    chip.addEventListener('click', function () { rowsEl.hidden = !rowsEl.hidden; });
    wrap.appendChild(rowsEl);
    return wrap;
  }
  // v3.1 R3 S2-4: a labeled cell wraps every visible field (label above the
  // control) — the register's "Label / Saved value / Analytics ID" columns are
  // no longer bare unlabeled inputs.
  function choiceCellWrap(field) {
    var cell = document.createElement('div');
    cell.className = 'lg-choice-cell';
    cell.setAttribute('data-choice-cell', field);
    var lab = document.createElement('span');
    lab.className = 'lg-choice-cell-label';
    lab.appendChild(document.createTextNode(CHOICE_FIELD_LABELS[field] || field));
    cell.appendChild(lab);
    return cell;
  }
  function buildChoiceTextInput(field, choice) {
    var inp = document.createElement('input');
    inp.className = 'form-input';
    inp.setAttribute('data-choice-field', field);
    inp.setAttribute('aria-label', CHOICE_FIELD_LABELS[field] || field);
    inp.setAttribute('placeholder', CHOICE_FIELD_PLACEHOLDERS[field] || CHOICE_FIELD_LABELS[field] || field);
    var v = choice ? choice[field] : undefined;
    inp.value = (v === undefined || v === null) ? '' : String(v);
    inp.addEventListener('input', collectChoices);
    inp.addEventListener('change', collectChoices);
    return inp;
  }
  // v3.1 R3 S2-5/6c: the choice 'icon' picker is the SAME 12 section-8.1
  // leading-icon options (a select, clearable via the "none" first option). A
  // stored legacy raw glyph is preserved as its own selectable option so it
  // round-trips.
  // v3.1 R3a correction (conductor-ruled): the choice 'icon' control is a
  // HYBRID — a curated <select> of the SAME 12 section-8.1 leading-icon options
  // (the common, human-legible case: home/car/shield/etc.) PLUS a "Custom
  // glyph…" escape hatch that preserves the PRE-EXISTING free-glyph convention
  // content-schema has always allowed for choice.icon (validateSectionContent's
  // isNonEmptyString check on choice.icon — NO enum restriction, unlike
  // node.props.icon's LEADGEN_FIELD_LEADING_ICONS gate). A pure closed picker
  // would silently regress real, validated authoring (e.g. business-type emoji
  // unrelated to the leading-icon vocabulary — a legitimate §8.4 use the studio
  // has always supported). The hidden input is the SINGLE value carrier
  // collectChoices reads (the emoji cell's own idiom, for consistency);
  // onChange fires on every user edit (select OR custom text) so the mutual-
  // exclusivity-with-emoji rule (§8.4) stays wired at the source of the change,
  // not via a synthetic event on the (non-firing) hidden input.
  function buildChoiceIconSelect(choice, onChange) {
    var cur = (choice && typeof choice.icon === 'string') ? choice.icon : '';
    var hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.setAttribute('data-choice-field', 'icon');
    hidden.value = cur;

    var sel = document.createElement('select');
    sel.className = 'form-input';
    sel.setAttribute('data-choice-icon-select', '');
    sel.setAttribute('aria-label', 'Icon');
    var opt0 = document.createElement('option');
    opt0.value = '';
    opt0.appendChild(document.createTextNode('\\u2014 none \\u2014'));
    sel.appendChild(opt0);
    var i, o, known = false;
    for (i = 0; i < CHOICE_ICON_OPTIONS.length; i++) {
      if (CHOICE_ICON_OPTIONS[i].value === 'none') { continue; }
      o = document.createElement('option');
      o.value = CHOICE_ICON_OPTIONS[i].value;
      o.appendChild(document.createTextNode(CHOICE_ICON_OPTIONS[i].label));
      sel.appendChild(o);
      if (CHOICE_ICON_OPTIONS[i].value === cur) { known = true; }
    }
    var customOpt = document.createElement('option');
    customOpt.setAttribute('data-choice-icon-custom-opt', '');
    customOpt.value = '__custom__';
    customOpt.appendChild(document.createTextNode('Custom glyph\\u2026'));
    sel.appendChild(customOpt);

    var isCustom = cur !== '' && cur !== 'none' && !known;
    sel.value = isCustom ? '__custom__' : (cur === 'none' ? '' : cur);

    var custom = document.createElement('input');
    custom.type = 'text';
    custom.className = 'form-input lg-choice-icon-custom';
    custom.setAttribute('data-choice-icon-custom', '');
    custom.setAttribute('aria-label', 'Custom icon glyph');
    custom.setAttribute('placeholder', 'Paste an emoji or glyph');
    custom.value = isCustom ? cur : '';
    custom.hidden = !isCustom;

    function commit(val) {
      hidden.value = val;
      if (onChange) { onChange(val); }
    }
    sel.addEventListener('change', function () {
      if (sel.value === '__custom__') {
        custom.hidden = false;
        commit(custom.value);
      } else {
        custom.hidden = true;
        custom.value = '';
        commit(sel.value);
      }
    });
    custom.addEventListener('input', function () { commit(custom.value); });
    custom.addEventListener('change', function () { commit(custom.value); });

    var wrap = document.createElement('span');
    wrap.className = 'lg-choice-icon-picker';
    wrap.appendChild(hidden);
    wrap.appendChild(sel);
    wrap.appendChild(custom);
    return {
      wrap: wrap,
      hidden: hidden,
      clear: function () {
        sel.value = '';
        custom.hidden = true;
        custom.value = '';
        hidden.value = '';
      },
    };
  }
  function setChoiceThumb(img, url) {
    if (url && trimStr(url) !== '') { img.src = url; img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
  }
  // v3.1 R3 S2-5(d): the image cell shows a THUMBNAIL next to Choose… (the media
  // picker is already wired). imageMediaId is a URL (presets renders src=it).
  function buildChoiceImageCell(choice) {
    var input = document.createElement('input');
    input.className = 'form-input';
    input.setAttribute('data-choice-field', 'imageMediaId');
    input.setAttribute('aria-label', 'Image');
    input.setAttribute('placeholder', CHOICE_FIELD_PLACEHOLDERS.imageMediaId);
    var v = (choice && typeof choice.imageMediaId === 'string') ? choice.imageMediaId : '';
    input.value = v;
    var thumb = document.createElement('img');
    thumb.className = 'lg-choice-thumb';
    thumb.setAttribute('data-choice-thumb', '');
    thumb.alt = '';
    setChoiceThumb(thumb, v);
    var choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'btn btn-sm btn-outline';
    choose.setAttribute('data-choice-media-choose', '');
    choose.appendChild(document.createTextNode('Choose\\u2026'));
    choose.addEventListener('click', function () {
      openMediaPicker({ input: input, onpick: function () { setChoiceThumb(thumb, input.value); collectChoices(); } });
    });
    input.addEventListener('input', function () { setChoiceThumb(thumb, input.value); collectChoices(); });
    input.addEventListener('change', function () { setChoiceThumb(thumb, input.value); collectChoices(); });
    var row = document.createElement('div');
    row.className = 'lg-choice-image-row';
    row.appendChild(thumb);
    row.appendChild(input);
    row.appendChild(choose);
    return { row: row, input: input };
  }
  function buildChoiceRow(choice, isMain, node) {
    var wrap = document.createElement('div');
    wrap.className = 'lg-choice-row';
    wrap.setAttribute('data-choice-row', '');
    var fields = choiceFieldsFor(node);
    var i, field, cell, control, val;
    var inputsByField = {};
    var emojiHidden = null, emojiPreview = null, iconCellRef = null;
    for (i = 0; i < fields.length; i++) {
      field = fields[i];
      cell = choiceCellWrap(field);
      if (field === 'icon') {
        // §8.4: emoji ⊕ icon are mutually exclusive — a real icon edit (select
        // OR the custom-glyph text) clears any stored emoji (closure captures
        // the emojiHidden/emojiPreview VARIABLES, assigned when the 'emoji'
        // field is processed later in this same loop — safe: the callback only
        // fires on a later user event, by which point the loop has finished).
        iconCellRef = buildChoiceIconSelect(choice, function (val2) {
          if (trimStr(val2) !== '' && emojiHidden) {
            emojiHidden.value = '';
            if (emojiPreview) { emojiPreview.textContent = '\\u2014'; }
          }
          collectChoices();
        });
        inputsByField.icon = iconCellRef.hidden;
        cell.appendChild(iconCellRef.wrap);
      } else if (field === 'emoji') {
        // v3.1 R3 S2-5(c): a curated emoji palette (hidden input stores the value
        // for collectChoices; a preview + clear + palette provide human choice).
        emojiHidden = document.createElement('input');
        emojiHidden.type = 'hidden';
        emojiHidden.setAttribute('data-choice-field', 'emoji');
        emojiHidden.value = (choice && typeof choice.emoji === 'string') ? choice.emoji : '';
        inputsByField.emoji = emojiHidden;
        var head = document.createElement('div');
        head.className = 'lg-choice-emoji-head';
        emojiPreview = document.createElement('span');
        emojiPreview.className = 'lg-choice-emoji-preview';
        emojiPreview.setAttribute('data-choice-emoji-preview', '');
        emojiPreview.appendChild(document.createTextNode(emojiHidden.value || '\\u2014'));
        var clr = document.createElement('button');
        clr.type = 'button';
        clr.className = 'btn btn-sm btn-outline';
        clr.setAttribute('data-choice-emoji-clear', '');
        clr.appendChild(document.createTextNode('Clear'));
        head.appendChild(emojiPreview);
        head.appendChild(clr);
        var palette = document.createElement('div');
        palette.className = 'lg-choice-emoji-palette';
        var pj, pb;
        for (pj = 0; pj < CHOICE_EMOJI_PALETTE.length; pj++) {
          pb = document.createElement('button');
          pb.type = 'button';
          pb.className = 'lg-choice-emoji-btn';
          pb.setAttribute('data-choice-emoji', CHOICE_EMOJI_PALETTE[pj]);
          pb.appendChild(document.createTextNode(CHOICE_EMOJI_PALETTE[pj]));
          palette.appendChild(pb);
        }
        cell.appendChild(emojiHidden);
        cell.appendChild(head);
        cell.appendChild(palette);
      } else if (field === 'imageMediaId') {
        var imgCell = buildChoiceImageCell(choice);
        inputsByField.imageMediaId = imgCell.input;
        cell.appendChild(imgCell.row);
      } else {
        control = buildChoiceTextInput(field, choice);
        inputsByField[field] = control;
        cell.appendChild(control);
      }
      wrap.appendChild(cell);
    }
    // §7.3: value auto-suggested from the label while un-edited.
    var valueInput = inputsByField['value'];
    if (valueInput) {
      valueInput.setAttribute('data-auto', valueInput.value === '' ? 'true' : 'false');
      valueInput.addEventListener('input', function () { this.setAttribute('data-auto', 'false'); });
    }
    var labelInput = inputsByField['label'];
    if (labelInput && valueInput) {
      labelInput.addEventListener('input', function () {
        if (valueInput.getAttribute('data-auto') === 'true') {
          valueInput.value = slugify(this.value);
          collectChoices();
        }
      });
    }
    // §8.4: emoji ⊕ icon are mutually exclusive — choosing one clears the other.
    // (the icon→emoji direction is wired at buildChoiceIconSelect's onChange
    // callback above; this is the emoji→icon direction.)
    var emojiBtns = wrap.querySelectorAll('[data-choice-emoji]');
    var eb;
    for (eb = 0; eb < emojiBtns.length; eb++) {
      emojiBtns[eb].addEventListener('click', (function (btn) {
        return function () {
          var v2 = btn.getAttribute('data-choice-emoji');
          if (emojiHidden) { emojiHidden.value = v2; }
          if (emojiPreview) { emojiPreview.textContent = v2; }
          if (iconCellRef) { iconCellRef.clear(); }
          collectChoices();
        };
      })(emojiBtns[eb]));
    }
    var emojiClear = wrap.querySelector('[data-choice-emoji-clear]');
    if (emojiClear) {
      emojiClear.addEventListener('click', function () {
        if (emojiHidden) { emojiHidden.value = ''; }
        if (emojiPreview) { emojiPreview.textContent = '\\u2014'; }
        collectChoices();
      });
    }
    var disabledLabel = document.createElement('label');
    disabledLabel.className = 'lg-check';
    var disabledCb = document.createElement('input');
    disabledCb.type = 'checkbox';
    disabledCb.setAttribute('data-choice-disabled', '');
    disabledCb.checked = !!(choice && choice.disabled === true);
    disabledCb.addEventListener('change', collectChoices);
    disabledLabel.appendChild(disabledCb);
    disabledLabel.appendChild(document.createTextNode('disabled'));
    wrap.appendChild(disabledLabel);
    var mainLabel = document.createElement('label');
    mainLabel.className = 'lg-check';
    var mainCb = document.createElement('input');
    mainCb.type = 'checkbox';
    mainCb.setAttribute('data-choice-main', '');
    mainCb.checked = !!isMain;
    mainCb.addEventListener('change', collectChoices);
    mainLabel.appendChild(mainCb);
    mainLabel.appendChild(document.createTextNode('main'));
    wrap.appendChild(mainLabel);
    // §7.3 reorder within the row grid.
    var reorder = document.createElement('span');
    reorder.className = 'studio-choice-reorder';
    reorder.appendChild(choiceRowMoveBtn(wrap, -1));
    reorder.appendChild(choiceRowMoveBtn(wrap, 1));
    wrap.appendChild(reorder);
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-sm btn-danger';
    rm.setAttribute('data-choice-remove', '');
    rm.textContent = 'Remove';
    rm.addEventListener('click', function () {
      if (wrap.parentNode) { wrap.parentNode.removeChild(wrap); }
      collectChoices();
    });
    wrap.appendChild(rm);
    // §12.2 C1: the read-only per-Offer provider-values chip ends the row.
    wrap.appendChild(buildProviderChip(node || selectedNode(), choice || {}));
    return wrap;
  }
  function choiceRowMoveBtn(wrap, delta) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline';
    b.setAttribute('data-choice-row-move', delta < 0 ? 'up' : 'down');
    b.setAttribute('aria-label', delta < 0 ? 'Move choice up' : 'Move choice down');
    b.appendChild(document.createTextNode(delta < 0 ? '\\u2191' : '\\u2193'));
    b.addEventListener('click', function () {
      var parent = wrap.parentNode;
      if (!parent) { return; }
      if (delta < 0 && wrap.previousElementSibling) { parent.insertBefore(wrap, wrap.previousElementSibling); }
      else if (delta > 0 && wrap.nextElementSibling) { parent.insertBefore(wrap.nextElementSibling, wrap); }
      collectChoices();
    });
    return b;
  }
  function renderChoiceEditor(node) {
    var c = choiceContainer();
    if (!c) { return; }
    clearChildren(c);
    var choices = (node && node.choices && node.choices.length) ? node.choices : [];
    var mains = (node && node.choiceDisplay && node.choiceDisplay.mainValues) ? node.choiceDisplay.mainValues : [];
    var i;
    for (i = 0; i < choices.length; i++) {
      c.appendChild(buildChoiceRow(choices[i], mains.indexOf(String(choices[i].value)) !== -1, node));
    }
  }
  function populateChoiceDisplay(node) {
    var en = document.querySelector('[data-choicedisplay="otherGroupEnabled"]');
    var lb = document.querySelector('[data-choicedisplay="otherGroupLabel"]');
    var se = document.querySelector('[data-choicedisplay="searchableOther"]');
    var d = (node && node.choiceDisplay) ? node.choiceDisplay : {};
    if (en) { en.checked = d.otherGroupEnabled === true; }
    if (lb) { lb.value = d.otherGroupLabel ? String(d.otherGroupLabel) : ''; }
    if (se) { se.checked = d.searchableOther === true; }
  }
  function collectChoiceDisplay(node, mains) {
    var en = document.querySelector('[data-choicedisplay="otherGroupEnabled"]');
    var lb = document.querySelector('[data-choicedisplay="otherGroupLabel"]');
    var se = document.querySelector('[data-choicedisplay="searchableOther"]');
    var enabled = !!(en && en.checked);
    if ((!enabled && mains.length === 0) || !node.choices || node.choices.length === 0) {
      delete node.choiceDisplay;
      return;
    }
    var display = { otherGroupEnabled: enabled };
    if (mains.length > 0) { display.mainValues = mains; }
    if (lb && trimStr(lb.value) !== '') { display.otherGroupLabel = trimStr(lb.value); }
    if (se && se.checked) { display.searchableOther = true; }
    node.choiceDisplay = display;
  }
  function collectChoices() {
    var node = selectedNode();
    if (!node) { return; }
    var c = choiceContainer();
    if (!c) { return; }
    var rows = c.querySelectorAll('[data-choice-row]');
    var choices = [], mains = [], i, j, inputs, choice, f, v, mainCb;
    for (i = 0; i < rows.length; i++) {
      inputs = rows[i].querySelectorAll('[data-choice-field]');
      choice = {};
      for (j = 0; j < inputs.length; j++) {
        f = inputs[j].getAttribute('data-choice-field');
        v = inputs[j].value;
        if (v !== '') { choice[f] = v; }
      }
      mainCb = rows[i].querySelector('[data-choice-main]');
      if (mainCb && mainCb.checked && choice.value !== undefined) { mains.push(String(choice.value)); }
      // §8.4 disabled rides a checkbox (boolean — set only when true).
      var disabledCb = rows[i].querySelector('[data-choice-disabled]');
      if (disabledCb && disabledCb.checked) { choice.disabled = true; }
      choices.push(choice);
    }
    if (choices.length > 0) { node.choices = choices; } else { delete node.choices; }
    collectChoiceDisplay(node, mains);
    afterModelChange();
  }
  function parseBulkChoices(text, req) {
    var lines = String(text || '').split('\\n');
    var out = [], i, line, at, label, value, c;
    for (i = 0; i < lines.length; i++) {
      line = trimStr(lines[i]);
      if (line === '') { continue; }
      // §5.5: "label = value" is the documented idiom; the legacy
      // "label|value" separator stays accepted.
      at = line.indexOf('|');
      if (at === -1) { at = line.indexOf('='); }
      label = at === -1 ? line : trimStr(line.slice(0, at));
      value = at === -1 ? slugify(line) : trimStr(line.slice(at + 1));
      if (label === '') { continue; }
      if (value === '') { value = slugify(label); }
      c = { label: label, value: value, analytics_id: value };
      if (req && req.choice_icon) { c.icon = '\\u2605'; }
      // A5: pasted image-grid choices carry image_alt next to imageMediaId
      // (§8.4 requirement — see sampleChoice).
      if (req && req.choice_image) { c.imageMediaId = 'media_' + value; c.image_alt = label; }
      out.push(c);
    }
    return out;
  }
  function applyBulkPaste() {
    var node = selectedNode();
    if (!node) { return; }
    var ta = document.querySelector('[data-choice-bulk]');
    if (!ta) { return; }
    var req = typeMeta(node.type).required || {};
    var parsed = parseBulkChoices(ta.value, req);
    if (parsed.length === 0) { return; }
    node.choices = parsed;
    delete node.choiceDisplay;
    renderChoiceEditor(node);
    populateChoiceDisplay(node);
    afterModelChange();
  }

  // --- raw node JSON (Advanced — the ONLY raw JSON surface) ---------------------
  function applyNodeJson() {
    var node = selectedNode();
    var ta = document.getElementById('lg-node-json');
    var errEl = document.querySelector('[data-studio-node-json-error]');
    if (!node || !ta) { return; }
    var parsed;
    try { parsed = JSON.parse(ta.value); } catch (e) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Invalid JSON: ' + e.message; }
      return;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'The node JSON must be an object with a string "type".'; }
      return;
    }
    if (typeof parsed.question_id !== 'string' || trimStr(parsed.question_id) === '') { parsed.question_id = node.question_id; }
    var ref = findRef(node.question_id);
    if (!ref) { return; }
    ref.list[ref.index] = parsed;
    selectedQuestionId = parsed.question_id;
    if (errEl) { errEl.hidden = true; }
    afterModelChange();
    selectComponent(parsed.question_id);
  }

  // --- §7.3 Advanced raw JSON: read-only + explicit "Edit raw…" confirm ---------
  function syncRawJsonMode() {
    var ta = document.getElementById('lg-node-json');
    var applyBtn = document.getElementById('lg-node-json-apply');
    var editBtn = document.getElementById('lg-node-json-edit');
    if (ta) {
      if (rawEditArmed) { ta.removeAttribute('readonly'); }
      else { ta.setAttribute('readonly', 'readonly'); }
    }
    if (applyBtn) { applyBtn.hidden = !rawEditArmed; }
    if (editBtn) { editBtn.hidden = rawEditArmed; }
  }
  function armRawEdit() {
    if (rawEditArmed) { return false; }
    if (!window.confirm('Edit the raw component JSON? Invalid structures are rejected on Apply, but raw edits bypass the guided controls.')) { return false; }
    rawEditArmed = true;
    syncRawJsonMode();
    return true;
  }

  // --- §9.4 role-override DOM decorations ----------------------------------------
  function ensureLegacyOption(sel, hex) {
    var i, has = false;
    for (i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === hex) { has = true; break; }
    }
    if (!has) {
      var o = document.createElement('option');
      o.value = hex;
      o.textContent = 'Custom color';
      sel.appendChild(o);
    }
  }
  function renderOverrideDecorations(node) {
    var i, key, sel, cur, resetBtn, srcEl, legacyEl, swatch;
    for (i = 0; i < COLOR_OVERRIDE_KEYS.length; i++) {
      key = COLOR_OVERRIDE_KEYS[i];
      sel = document.getElementById('lg-inspector-' + key);
      cur = (node && node.design_overrides) ? node.design_overrides[key] : undefined;
      if (sel && isHexColor(cur)) { ensureLegacyOption(sel, String(cur)); sel.value = String(cur); }
      resetBtn = document.querySelector('[data-override-reset="' + key + '"]');
      if (resetBtn) { resetBtn.hidden = !node || cur === undefined || cur === null || cur === ''; }
      srcEl = document.querySelector('[data-override-source="' + key + '"]');
      if (srcEl) { srcEl.textContent = node ? overrideSourceText(key, cur) : ''; }
      legacyEl = document.querySelector('[data-override-custom="' + key + '"]');
      if (legacyEl) { legacyEl.hidden = !node || !isHexColor(cur); }
      swatch = document.querySelector('[data-override-swatch="' + key + '"]');
      if (swatch && swatch.style) { swatch.style.background = node ? resolvedOverrideColor(key, cur) : ''; }
    }
  }
  function resetOverride(key) {
    var node = selectedNode();
    if (!node || !node.design_overrides) { return; }
    delete node.design_overrides[key];
    cleanupEmpty(node, 'design_overrides');
    afterModelChange();
    populateInspector();
  }
  // §9.4 "Convert to a theme color": exact default-design match converts in
  // place; no match → the operator picks from the (focused) role select.
  function convertLegacyOverride(key) {
    var node = selectedNode();
    if (!node || !node.design_overrides) { return null; }
    var cur = node.design_overrides[key];
    var role = legacyHexToRole(cur);
    if (role !== null) {
      node.design_overrides[key] = role;
      afterModelChange();
      populateInspector();
      return role;
    }
    var sel = document.getElementById('lg-inspector-' + key);
    if (sel && sel.focus) { sel.focus(); }
    return null;
  }

  // --- §9.5 Section-overrides drawer mode: populate + collect --------------------
  function renderSectionOverrideSwatches() {
    var palette = (state.design_overrides && state.design_overrides.palette) ? state.design_overrides.palette : {};
    var swatches = document.querySelectorAll('[data-section-role-swatch]');
    var i, role, v, resolved;
    for (i = 0; i < swatches.length; i++) {
      role = swatches[i].getAttribute('data-section-role-swatch');
      v = palette[role];
      resolved = isHexColor(v) ? v : (v && ROLE_VALUES[v]) ? ROLE_VALUES[v] : (ROLE_VALUES[role] || '');
      if (swatches[i].style) { swatches[i].style.background = resolved; }
    }
  }
  function populateSectionOverrides() {
    var ov = (state.design_overrides && typeof state.design_overrides === 'object') ? state.design_overrides : {};
    var palette = (ov.palette && typeof ov.palette === 'object') ? ov.palette : {};
    var sels = document.querySelectorAll('[data-section-role]');
    var i, role, v;
    for (i = 0; i < sels.length; i++) {
      role = sels[i].getAttribute('data-section-role');
      v = palette[role];
      if (isHexColor(v)) { ensureLegacyOption(sels[i], String(v)); }
      sels[i].value = (v === undefined || v === null) ? '' : String(v);
    }
    var colsEl = document.querySelector('[data-section-columns-default]');
    if (colsEl) { colsEl.value = typeof ov.columnsDefault === 'number' ? String(ov.columnsDefault) : ''; }
    var gapEl = document.querySelector('[data-section-gap-default]');
    if (gapEl) { gapEl.value = typeof ov.gapDefault === 'string' ? ov.gapDefault : ''; }
    renderSectionOverrideSwatches();
  }
  function collectSectionOverrides() {
    state.design_overrides = buildSectionOverrides();
    markDirty();
    renderSectionOverrideSwatches();
    scheduleCanvasRender();
  }

  // --- §6.6 presets: load + Design-tab dropdown + apply + save -------------------
  function renderPresetControls() {
    var node = selectedNode();
    var designSel = document.querySelector('[data-preset-select]');
    var applySel = document.querySelector('[data-preset-apply]');
    var list = node ? presetsForType(node.type) : [];
    var i, o;
    if (designSel) {
      clearChildren(designSel);
      o = document.createElement('option');
      o.value = '';
      o.textContent = '(none)';
      designSel.appendChild(o);
      for (i = 0; i < list.length; i++) {
        o = document.createElement('option');
        o.value = list[i].name;
        o.textContent = list[i].name;
        designSel.appendChild(o);
      }
      var cur = node && node.design_preset ? String(node.design_preset) : '';
      if (cur !== '' && presetByName(cur) === null) {
        // provenance for a deleted/renamed preset stays visible, never dropped
        o = document.createElement('option');
        o.value = cur;
        o.textContent = cur + ' (stored)';
        designSel.appendChild(o);
      }
      designSel.value = cur;
      designSel.disabled = !node;
    }
    if (applySel) {
      clearChildren(applySel);
      o = document.createElement('option');
      o.value = '';
      o.textContent = 'Apply preset…';
      applySel.appendChild(o);
      for (i = 0; i < list.length; i++) {
        o = document.createElement('option');
        o.value = list[i].name;
        o.textContent = list[i].name;
        applySel.appendChild(o);
      }
      // §6.6: mismatched type (no presets for this type) → disabled.
      applySel.disabled = !node || list.length === 0;
    }
  }
  function loadComponentPresets() {
    fetchItems('/api/admin/leadgen/component-presets', function (items) {
      presetsData = items || [];
      renderPresetControls();
    });
  }
  function savePresetFromSelection() {
    var node = selectedNode();
    if (!node) { return; }
    var name = trimStr(window.prompt('Preset name'));
    if (name === '') { return; }
    var payload = buildPresetPayload(node);
    payload.name = name;
    fetch('/api/admin/leadgen/component-presets', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok) {
        showRefusal('Preset save failed: ' + ((res.body && res.body.error) || 'error'));
        return;
      }
      presetsData = (res.body && res.body.items) || presetsData;
      node.design_preset = name;
      afterModelChange();
      renderPresetControls();
    }).catch(function () { showRefusal('Preset save failed: network error'); });
  }

  // --- §5.5/§6.4 media picker (the shared Media-library chooser) -----------------
  var mediaPickTarget = null;
  function mediaSrc(v) {
    var str = String(v || '');
    if (str === '') { return ''; }
    if (str.charAt(0) === '/' || str.indexOf('http://') === 0 || str.indexOf('https://') === 0 || str.indexOf('data:') === 0) { return str; }
    return '/media/' + str;
  }
  function mediaPickerStatus(text) {
    var el = document.getElementById('lg-media-picker-status');
    if (el) {
      clearChildren(el);
      if (text) { el.appendChild(document.createTextNode(text)); }
    }
  }
  function closeMediaPicker() {
    var overlay = document.getElementById('lg-media-picker');
    if (overlay) { overlay.className = 'lg-media-picker-overlay lg-hidden'; }
    mediaPickTarget = null;
  }
  function renderMediaGrid(items) {
    var grid = document.getElementById('lg-media-picker-grid');
    if (!grid) { return; }
    clearChildren(grid);
    if (!items || items.length === 0) {
      var pEl = document.createElement('p');
      pEl.className = 'form-help';
      pEl.appendChild(document.createTextNode('No images in the Media library yet — upload one above.'));
      grid.appendChild(pEl);
      return;
    }
    var i, it, btn, img, name;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (!it || !it.storage_key) { continue; }
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lg-media-item';
      btn.setAttribute('data-media-pick', it.storage_key);
      btn.title = it.filename || it.storage_key;
      img = document.createElement('img');
      img.setAttribute('src', mediaSrc(it.storage_key));
      img.setAttribute('alt', it.alt_text || it.filename || '');
      btn.appendChild(img);
      name = document.createElement('span');
      name.appendChild(document.createTextNode(it.filename || it.storage_key));
      btn.appendChild(name);
      grid.appendChild(btn);
    }
  }
  function loadMediaList() {
    mediaPickerStatus('Loading…');
    fetch('/api/admin/media', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { mediaPickerStatus('Could not load the Media library.'); return; }
        mediaPickerStatus('');
        renderMediaGrid((res.body && res.body.media) || []);
      })
      .catch(function () { mediaPickerStatus('Could not load the Media library.'); });
  }
  function openMediaPicker(target) {
    mediaPickTarget = target;
    var overlay = document.getElementById('lg-media-picker');
    if (overlay) { overlay.className = 'lg-media-picker-overlay'; }
    loadMediaList();
  }
  function applyMediaPick(storageKey) {
    var target = mediaPickTarget;
    closeMediaPicker();
    if (!target) { return; }
    if (target.input) {
      target.input.value = storageKey;
      if (target.input.setAttribute) { target.input.setAttribute('data-auto', 'false'); }
      if (target.onpick) { target.onpick(); }
      return;
    }
    if (target.qid) {
      var ref = findRef(target.qid);
      if (!ref) { return; }
      var c = findChoice(ref.node, target.value);
      if (!c) { return; }
      c.imageMediaId = storageKey;
      // A5: image_alt is REQUIRED next to imageMediaId — default to the label.
      if (!c.image_alt || trimStr(c.image_alt) === '') { c.image_alt = c.label || storageKey; }
      afterModelChange();
      renderChoiceEditor(ref.node);
    }
  }
  function uploadMediaFile() {
    var fileInput = document.getElementById('lg-media-upload-file');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) { mediaPickerStatus('Choose an image file first.'); return; }
    var fd = new FormData();
    fd.append('file', fileInput.files[0]);
    mediaPickerStatus('Uploading…');
    fetch('/api/admin/media/upload', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || !res.body.item || !res.body.item.storage_key) {
          mediaPickerStatus((res.body && res.body.error) ? res.body.error : 'Upload failed.');
          return;
        }
        mediaPickerStatus('');
        fileInput.value = '';
        applyMediaPick(res.body.item.storage_key);
      })
      .catch(function () { mediaPickerStatus('Upload failed: network error.'); });
  }
  // FIX 8c (§8.4): "Generate with AI" — the EXISTING admin generation
  // endpoint (POST /api/admin/ai/image writes R2 + the media row); the
  // resulting storage_key flows through the SAME applyMediaPick path an
  // upload takes. The control is server-hidden when the route is unavailable.
  function generateMediaWithAi() {
    var promptEl = document.getElementById('lg-media-ai-prompt');
    var prompt = promptEl ? trimStr(promptEl.value) : '';
    if (prompt === '') { mediaPickerStatus('Describe the image to generate first.'); return; }
    mediaPickerStatus('Generating\\u2026');
    fetch('/api/admin/ai/image', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.storage_key) {
        mediaPickerStatus((res.body && res.body.error) ? res.body.error : 'Image generation failed.');
        return;
      }
      mediaPickerStatus('');
      if (promptEl) { promptEl.value = ''; }
      applyMediaPick(res.body.storage_key);
    }).catch(function () { mediaPickerStatus('Image generation failed: network error.'); });
  }

  // --- §5.4 Move to funnel layout: the LIVE action -------------------------------
  function showMoveNote(text) {
    var note = document.querySelector('[data-studio-pending-note]');
    if (note) { note.hidden = false; note.textContent = text; }
  }
  // FIX 1a (BLOCKER): removing the MOVED node must never destroy its
  // children — a container (BackgroundPanel) dissolves exactly like Ungroup
  // (§6.1.5): its children splice into the parent list at the node's index,
  // order preserved. Leaf frame nodes remove exactly as before.
  function removeMovedFrameNode(qid) {
    var ref = findRef(qid);
    if (!ref) { return; }
    if (isContainerType(ref.node.type) && ref.node.children && ref.node.children.length > 0) {
      var children = ref.node.children;
      var args = [ref.index, 1];
      var i;
      for (i = 0; i < children.length; i++) { args.push(children[i]); }
      Array.prototype.splice.apply(ref.list, args);
      if (selectedQuestionId === qid) { selectedQuestionId = null; }
      afterModelChange();
      return;
    }
    removeNode(qid);
  }
  // Finish: remove the node and persist the removal on the SAME action — a
  // content-only PATCH (merge-then-revalidate keeps every other stored field;
  // §5.4 "delete-from-Section only after confirm").
  function finishMoveToFrame(qid, funnel, wasDirty) {
    removeMovedFrameNode(qid);
    if (selectedQuestionId === qid) { selectComponent(null); }
    if (!state.public_id) {
      showMoveNote('Moved into the funnel layout of “' + funnel.name + '”. Save the Section to persist the removal.');
      return;
    }
    fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      // v3.1 R3 MINOR-3 (reland): route through collectSection — the ONE
      // shared save/migration helper, no duplicate logic — so this
      // content-only PATCH runs the SAME §5.3/§8.1/§11.3 migrations as the
      // main Save. confirmSaveMigrationLoss already gated doMoveToFrame
      // before any write began, so by here the operator has consented if the
      // tree contains a retired LogoStrip anywhere.
      body: JSON.stringify({ content_json: collectSection().content_json })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok) {
        showRefusal('The element moved into the funnel layout, but saving its removal failed: ' + ((res.body && res.body.error) || 'error') + ' — Save the Section to persist it.');
        return;
      }
      // R4a deliverable 20 scope note: NOT wired to renderDirtyIndicator()
      // here (unlike the Save/Archive buttons) — this vm-probed function is
      // sliced standalone by test/leadgen-section-studio-ui.test.ts's own
      // MODEL_FUNCS-style technique (function-name allowlist), and adding a
      // call to a function outside that allowlist throws ReferenceError in
      // its isolated sandbox. The indicator still catches up on the next
      // markDirty()/Save.
      if (!wasDirty) { dirty = false; }
      showMoveNote('Moved into the funnel layout of “' + funnel.name + '” — the Section was saved without the element.');
    }).catch(function () {
      showRefusal('The element moved into the funnel layout, but saving its removal failed — Save the Section to persist it.');
    });
  }
  function doMoveToFrame(qid, funnel) {
    var ref = findRef(qid);
    if (!ref) { return; }
    // §5.4: explicit confirm that NAMES the funnel, before any write.
    if (!window.confirm(moveConfirmMessage(ref.node, funnel.name))) { return; }
    // v3.1 R3 MINOR-3 (reland): the ensuing finishMoveToFrame save now runs
    // collectSection's §5.3 migration, which is LOSSY for a retired LogoStrip
    // ANYWHERE in the section (not just the moved node) — confirm BEFORE any
    // write (frame GET/PUT + content PATCH) so a cancel leaves EVERYTHING
    // untouched, matching the main Save button's "cancel = no save" contract.
    if (!confirmSaveMigrationLoss()) { return; }
    var group = equivalentFrameGroup(ref.node);
    if (group === null) {
      showRefusal('This element has no funnel-layout equivalent — configure it in the Quote Builder instead.');
      return;
    }
    var wasDirty = dirty;
    fetch('/api/admin/leadgen/funnels/' + encodeURIComponent(funnel.public_id) + '/frame', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok) {
        showRefusal('Could not read the funnel layout — the element stays in this Section.');
        return null;
      }
      var merged = mergeFrameGroups(res.body ? res.body.frame_config : null, group);
      return fetch('/api/admin/leadgen/funnels/' + encodeURIComponent(funnel.public_id) + '/frame', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ frame_config_json: merged })
      }).then(function (r2) {
        return r2.json().then(function (j2) { return { ok: r2.ok, body: j2 }; });
      }).then(function (putRes) {
        if (!putRes.ok) {
          showRefusal('Funnel-layout save failed: ' + ((putRes.body && putRes.body.error) || 'error') + ' — the element stays in this Section.');
          return;
        }
        finishMoveToFrame(qid, funnel, wasDirty);
      });
    }).catch(function () {
      showRefusal('Funnel-layout save failed — the element stays in this Section.');
    });
  }
  function funnelPickBtn(qid, funnel) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline';
    b.setAttribute('data-funnel-pick', funnel.public_id);
    b.textContent = funnel.name;
    b.addEventListener('click', function () { doMoveToFrame(qid, funnel); });
    return b;
  }
  // §5.4 used-by-many: a picker listing the funnels; applying to the chosen
  // one (the confirm still names it) and deleting from the Section only after.
  function renderFunnelPicker(qid, funnels) {
    // the badge is a canvas decoration — it lives INSIDE the frame document.
    var region = canvasRegion();
    var badge = region ? region.querySelector('[data-frame-badge="' + qid + '"]') : null;
    if (!badge) { return; }
    var oldPicker = badge.querySelector('[data-funnel-picker]');
    if (oldPicker) { badge.removeChild(oldPicker); return; }
    var picker = document.createElement('span');
    picker.className = 'studio-funnel-picker';
    picker.setAttribute('data-funnel-picker', qid);
    var label = document.createElement('span');
    label.appendChild(document.createTextNode('Used by ' + funnels.length + ' funnels — move to:'));
    picker.appendChild(label);
    var i;
    for (i = 0; i < funnels.length; i++) { picker.appendChild(funnelPickBtn(qid, funnels[i])); }
    badge.appendChild(picker);
  }
  function startMoveToFrame(qid) {
    var funnels = usageFunnelsOf();
    if (funnels.length === 0) {
      showRefusal('This Section isn’t used by any funnel yet — there is no funnel layout to move this element into. Configure it in the Quote Builder.');
      return;
    }
    if (funnels.length === 1) { doMoveToFrame(qid, funnels[0]); return; }
    renderFunnelPicker(qid, funnels);
  }

  // --- §5.3 mode 5: frame picker loads + empty state ------------------------------
  function renderFramePreviewEmpty() {
    var el = document.querySelector('[data-frame-preview-empty]');
    if (!el) { return; }
    el.hidden = !(usageQuoteCount !== null && usageQuoteCount === 0);
  }
  function populateFramePickSelect(sel, entries, placeholder, current) {
    if (!sel) { return; }
    clearChildren(sel);
    var o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    sel.appendChild(o);
    var i;
    for (i = 0; i < entries.length; i++) {
      o = document.createElement('option');
      o.value = entries[i].value;
      o.textContent = entries[i].label;
      sel.appendChild(o);
    }
    sel.value = current || '';
    sel.disabled = entries.length === 0;
  }
  function loadFramePickerQuotes() {
    var quoteSel = document.querySelector('[data-frame-pick-quote]');
    if (!quoteSel) { return; }
    fetchItems('/api/admin/leadgen/quotes', function (items) {
      var entries = [], i;
      for (i = 0; i < items.length; i++) {
        if (items[i] && items[i].public_id) {
          entries.push({ value: items[i].public_id, label: items[i].quote_name || items[i].public_id });
        }
      }
      populateFramePickSelect(quoteSel, entries, '— no frame (unit only) —', framePick.quote);
      quoteSel.disabled = false;
    });
  }
  function populateFramePickFunnels() {
    var funnelSel = document.querySelector('[data-frame-pick-funnel]');
    var entries = [], i;
    for (i = 0; i < framePickFunnels.length; i++) {
      if (framePickFunnels[i] && framePickFunnels[i].public_id) {
        entries.push({ value: framePickFunnels[i].public_id, label: framePickFunnels[i].funnel_name || framePickFunnels[i].public_id });
      }
    }
    populateFramePickSelect(funnelSel, entries, 'Funnel…', framePick.funnel);
  }
  function populateFramePickVariants() {
    var variantSel = document.querySelector('[data-frame-pick-variant]');
    var entries = [], i, j, f;
    for (i = 0; i < framePickFunnels.length; i++) {
      f = framePickFunnels[i];
      if (!f || f.public_id !== framePick.funnel || !f.variants) { continue; }
      for (j = 0; j < f.variants.length; j++) {
        if (f.variants[j] && f.variants[j].public_id) {
          entries.push({ value: f.variants[j].public_id, label: f.variants[j].variant_label || f.variants[j].public_id });
        }
      }
    }
    populateFramePickSelect(variantSel, entries, 'Variant…', framePick.variant);
  }
  function loadFramePickSites(quotePublicId) {
    var siteSel = document.querySelector('[data-frame-pick-site]');
    if (!siteSel) { return; }
    fetch('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/activation', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (j) {
      var sites = (j && j.sites) || [];
      var entries = [], i;
      for (i = 0; i < sites.length; i++) {
        if (sites[i] && sites[i].site_id) {
          entries.push({ value: sites[i].site_id, label: sites[i].site_name || sites[i].site_id });
        }
      }
      populateFramePickSelect(siteSel, entries, '— no site branding —', framePick.site);
    }).catch(function () {});
  }
  function onFramePickQuote(quotePublicId) {
    framePick.quote = quotePublicId;
    framePick.funnel = '';
    framePick.variant = '';
    framePick.site = '';
    framePickFunnels = [];
    populateFramePickFunnels();
    populateFramePickVariants();
    populateFramePickSelect(document.querySelector('[data-frame-pick-site]'), [], '— no site branding —', '');
    if (quotePublicId === '') { runPreview(); return; }
    fetchItems('/api/admin/leadgen/quotes/' + encodeURIComponent(quotePublicId) + '/funnels', function (items) {
      framePickFunnels = items || [];
      populateFramePickFunnels();
    });
    loadFramePickSites(quotePublicId);
    runPreview();
  }

  // --- library: search + click-to-add + drag source ------------------------------
  // §5.6 the "Contact" tile's childTypes (optional): a Stack of three
  // individually editable/deletable nodes. Every other tile passes no
  // childTypes and behaves exactly as before. defaultProps (optional, m2):
  // starting props beyond a bare default-typed node — the Divider tile's
  // variant:"line" is the first consumer.
  function addFromLibrary(type, childTypes, defaultProps) {
    var node = null;
    if (pendingInsert) {
      node = insertRelative(pendingInsert.qid, pendingInsert.where, type, childTypes, defaultProps);
      pendingInsert = null;
      updatePendingUi();
    } else {
      var sel = selectedNode();
      if (sel && isContainerType(sel.type)) { node = addComponentAt(type, sel.question_id, null, childTypes, defaultProps); }
      else { node = addComponentAt(type, null, null, childTypes, defaultProps); }
    }
    if (node) { selectComponent(node.question_id); }
  }
  // §5.6 the "Contact" tile carries data-add-children (comma-separated types)
  // — a full 3-node Stack. v3.1 audit-round G FIX 4: drag now carries these
  // through the 'add:' JSON envelope, so a DRAG insert builds the same
  // populated Stack as click/keyboard (no longer degrades to an EMPTY Stack).
  function libraryChildTypesOf(btn) {
    var attr = btn.getAttribute('data-add-children');
    return attr ? attr.split(',') : undefined;
  }
  // m2: data-add-props (JSON-encoded, e.g. the Divider tile's {"variant":
  // "line"}). v3.1 audit-round G FIX 4: drag carries these through the same
  // JSON envelope, so a dragged Divider is a Spacer variant:"line" (no longer
  // a plain Spacer) — drag == click == keyboard.
  function libraryPropsOf(btn) {
    var attr = btn.getAttribute('data-add-props');
    if (!attr) { return undefined; }
    try { return JSON.parse(attr); } catch (eProps) { return undefined; }
  }
  var libraryEl = document.querySelector('[data-studio-library]');
  if (libraryEl) {
    libraryEl.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn) { return; }
      // §5.2: a disabled bound item never consumes the armed insertion point.
      if (btn.getAttribute('data-bind-disabled') === 'true') { return; }
      addFromLibrary(btn.getAttribute('data-add-component'), libraryChildTypesOf(btn), libraryPropsOf(btn));
    });
    // the items are role="button" divs (nested-button validity) — keep the
    // native keyboard activation contract.
    libraryEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn) { return; }
      ev.preventDefault();
      if (btn.getAttribute('data-bind-disabled') === 'true') { return; }
      addFromLibrary(btn.getAttribute('data-add-component'), libraryChildTypesOf(btn), libraryPropsOf(btn));
    });
    libraryEl.addEventListener('dragstart', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn || !ev.dataTransfer) { return; }
      // v3.1 audit-round G FIX 4: carry the tile's childTypes + defaultProps
      // through a JSON envelope so a DRAG insert is byte-identical to the
      // click/keyboard insert (§5.6 determinism — ONE insert per tile). The
      // 'add:' prefix stays so the drop handler's kind split (first ':') is
      // unchanged; everything after it is the JSON spec.
      var spec = { type: btn.getAttribute('data-add-component') };
      var childTypes = libraryChildTypesOf(btn);
      if (childTypes) { spec.childTypes = childTypes; }
      var defaultProps = libraryPropsOf(btn);
      if (defaultProps) { spec.defaultProps = defaultProps; }
      ev.dataTransfer.setData('text/plain', 'add:' + JSON.stringify(spec));
    });
    // §5.1 group collapse/expand: chevron rotates 0→90°, click toggles.
    function setGroupOpen(key, open) {
      var header = libraryEl.querySelector('[data-library-group-toggle="' + key + '"]');
      var itemsEl = libraryEl.querySelector('[data-library-items="' + key + '"]');
      if (header) {
        header.setAttribute('aria-expanded', open ? 'true' : 'false');
        var chev = header.querySelector('svg');
        if (chev) { chev.setAttribute('style', 'transform:rotate(' + (open ? 90 : 0) + 'deg)'); }
      }
      if (itemsEl) { itemsEl.hidden = !open; }
    }
    var groupToggles = libraryEl.querySelectorAll('[data-library-group-toggle]');
    var gt;
    function onGroupToggleActivate() {
      var key = this.getAttribute('data-library-group-toggle');
      var open = this.getAttribute('aria-expanded') !== 'true';
      setGroupOpen(key, open);
    }
    for (gt = 0; gt < groupToggles.length; gt++) {
      groupToggles[gt].addEventListener('click', onGroupToggleActivate);
      groupToggles[gt].addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onGroupToggleActivate.call(this); }
      });
    }
    // §5.1/§5.5 search: case-insensitive substring of the tile's data-name,
    // across ALL groups — while a query is active every group is forced
    // OPEN (so a match inside a collapsed group like Layout is reachable);
    // clearing the query restores each group to its own toggled state
    // (read from aria-expanded, which the collapse handler above keeps live).
    var search = libraryEl.querySelector('[data-studio-library-search]');
    if (search) {
      search.addEventListener('input', function () {
        var q = trimStr(this.value).toLowerCase();
        var items = libraryEl.querySelectorAll('[data-tile]');
        var i, name;
        for (i = 0; i < items.length; i++) {
          name = items[i].getAttribute('data-name') || '';
          items[i].style.display = (q === '' || name.indexOf(q) !== -1) ? '' : 'none';
        }
        var groupEls = libraryEl.querySelectorAll('[data-library-items]');
        var g, key, header, wantOpen;
        for (g = 0; g < groupEls.length; g++) {
          if (q !== '') { groupEls[g].hidden = false; continue; }
          key = groupEls[g].getAttribute('data-library-items');
          header = libraryEl.querySelector('[data-library-group-toggle="' + key + '"]');
          wantOpen = header ? header.getAttribute('aria-expanded') === 'true' : true;
          groupEls[g].hidden = !wantOpen;
        }
      });
    }
  }

  // --- canvas events: select / drag-drop / keyboard reorder -----------------------
  // DEV-66: the SAME named handlers bind TWICE — on the parent surface (frame
  // hint gutter, palette drops past the frame, keyboard on the focused
  // surface) AND on the srcdoc iframe's contentDocument (every node/choice
  // hit-target now lives there — the ui-quotes onCanvasClick idiom). The
  // document persists across region re-renders, so one binding per loaded
  // document is enough.
  var dropHint = null;
  var canvasSurface = document.getElementById('lg-studio-canvas');
  // ownership check that spans BOTH roots (contains() never crosses the
  // document boundary).
  function canvasOwns(el) {
    if (!el) { return false; }
    if (canvasSurface && canvasSurface.contains && canvasSurface.contains(el)) { return true; }
    var region = canvasRegion();
    return !!(region && region.contains && region.contains(el));
  }
  function onCanvasClick(ev) {
      // §5.4 amber-badge actions (the badge is a sibling of the node, so the
      // component-select path below never fires for it). Keep (legacy) = NO
      // model change — session-local acknowledgement only; the C2 activation
      // consequence stays named on other badges. Move is LIVE (wave 2).
      var keepBtn = ev.target && ev.target.closest ? ev.target.closest('[data-frame-keep]') : null;
      if (keepBtn) {
        keptLegacyFrameNodes[keepBtn.getAttribute('data-frame-keep')] = true;
        applyCanvasDecoration();
        return;
      }
      var moveBtn = ev.target && ev.target.closest ? ev.target.closest('[data-frame-move]') : null;
      if (moveBtn) {
        startMoveToFrame(moveBtn.getAttribute('data-frame-move'));
        return;
      }
      // funnel-picker buttons wire their own handlers; don't fall through.
      if (ev.target && ev.target.closest && ev.target.closest('[data-funnel-picker]')) { return; }
      // §6.2 inline choice ops: per-choice ✕ + the "+ Add choice" ghost tile.
      var xBtn = ev.target && ev.target.closest ? ev.target.closest('[data-choice-x]') : null;
      if (xBtn) {
        var xRef = findRef(xBtn.getAttribute('data-choice-x-qid'));
        if (xRef) {
          removeChoiceFromNode(xRef.node, xBtn.getAttribute('data-choice-x'));
          if (selectedQuestionId === xRef.node.question_id) { renderChoiceEditor(xRef.node); }
        }
        return;
      }
      var ghostBtn = ev.target && ev.target.closest ? ev.target.closest('[data-choice-ghost]') : null;
      if (ghostBtn) {
        var gRef = findRef(ghostBtn.getAttribute('data-choice-ghost'));
        if (gRef) {
          var added = addChoiceToNode(gRef.node);
          if (added) { selectChoice(gRef.node.question_id, String(added.value)); }
        }
        return;
      }
      // R2 S1-8: a click on a resize handle (mousedown+mouseup with no real
      // drag) must NEVER change selection. The trailing native click's target is
      // the handle — a SIBLING of the field inside the selection wrap — whose
      // closest('[data-question-id]') used to resolve to the PARENT container and
      // silently DESELECT the field. Swallow any click that lands on a handle.
      if (ev.target && ev.target.closest && ev.target.closest('[data-field-resize-handle]')) { return; }
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!el || !canvasOwns(el)) { return; }
      ev.preventDefault();
      // §6.2/§6.4: clicking a card/button selects the CHOICE, not just the
      // component (the inspector opens the Choices tab at that row).
      var cardEl = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
      if (cardEl && el.contains(cardEl) && typeMeta(el.getAttribute('data-component-type')).choice === true) {
        selectChoice(el.getAttribute('data-question-id'), cardEl.getAttribute('data-lg-choice'));
        return;
      }
      // R2 S1-7: skip a same-node re-select. Re-selecting re-runs
      // applyCanvasDecoration (rebuilding this field's wrap/chrome); clicking an
      // ALREADY-selected field would then rebuild between the two clicks of a
      // dblclick, and the inline placeholder edit (S1-7) would never start. A
      // same-node click is a no-op — the field stays selected, its chrome stable.
      var clickQid = el.getAttribute('data-question-id');
      if (clickQid !== selectedQuestionId) { selectComponent(clickQid); }
  }
  // §6.2 inline text editing on double-click: bound/label/helper text writes
  // the bound column or props; a choice card edits its label.
  function onCanvasDblClick(ev) {
      // R2 S1-8: a dblclick on a resize handle does nothing (keep native).
      if (ev.target && ev.target.closest && ev.target.closest('[data-field-resize-handle]')) { return; }
      var host = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      var qid = host ? host.getAttribute('data-question-id') : null;
      var fieldEl = host;
      if (!host || !canvasOwns(host)) { return; }
      var ref = findRef(qid);
      if (!ref) { return; }
      var cardEl = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
      if (cardEl && typeMeta(ref.node.type).choice === true) {
        ev.preventDefault();
        var choiceValue = cardEl.getAttribute('data-lg-choice');
        var cardTitle = cardEl.querySelector('.lg-card-title') || cardEl;
        startInlineEdit(cardTitle, function (text) { commitInlineChoiceLabel(qid, choiceValue, text); });
        return;
      }
      // R2 S1-7 / E1-C4: the support check runs BEFORE preventDefault — an
      // UNSUPPORTED type (e.g. a native DATE field: inlineEditKeyFor -> null,
      // date excluded) keeps its native dblclick behavior instead of hitting the
      // old silent dead end (preventDefault-then-bail).
      var key = inlineEditKeyFor(ref.node);
      if (key === null) { return; }
      ev.preventDefault();
      if (key === 'placeholder') {
        // The text-input family edits its PLACEHOLDER via the input's value
        // (contenteditable is a no-op on an <input>) — see startPlaceholderEdit.
        var inputEl = (fieldEl && fieldEl.tagName && String(fieldEl.tagName).toUpperCase() === 'INPUT') ? fieldEl : (fieldEl && fieldEl.querySelector ? fieldEl.querySelector('input') : null);
        if (inputEl) { startPlaceholderEdit(inputEl, qid); }
        return;
      }
      startInlineEdit(host, function (text) { commitInlineText(qid, key, text); });
  }
  // §6.2 container resize handles snap to the width presets only. The handle
  // lives in the frame document; the release may land in EITHER document
  // (pointer dragged out of the iframe) — listen on both, translate a
  // parent-side clientX into frame coordinates via the frame's rect.
  function onCanvasMouseDown(ev) {
      var handle = ev.target && ev.target.closest ? ev.target.closest('[data-resize-handle]') : null;
      if (!handle) { return; }
      ev.preventDefault();
      var qid = handle.getAttribute('data-resize-handle');
      var startX = ev.clientX;
      var innerDoc = canvasFrameDoc();
      var startedInFrame = !!(innerDoc && handle.ownerDocument === innerDoc);
      function finishUp(upEv, viaParent) {
        if (innerDoc && innerDoc.removeEventListener) { innerDoc.removeEventListener('mouseup', onUpInner); }
        document.removeEventListener('mouseup', onUpOuter);
        var endX = upEv.clientX;
        var frame = canvasFrameEl();
        if (startedInFrame && viaParent && frame && frame.getBoundingClientRect) {
          endX = upEv.clientX - frame.getBoundingClientRect().left;
        }
        var ref = findRef(qid);
        if (!ref) { return; }
        var props = ensureObj(ref.node, 'props');
        var next = snapWidthPreset(typeof props.width === 'string' ? props.width : 'm', endX - startX);
        if (next !== props.width) { props.width = next; afterModelChange(); }
      }
      function onUpInner(upEv) { finishUp(upEv, false); }
      function onUpOuter(upEv) { finishUp(upEv, true); }
      if (innerDoc && innerDoc.addEventListener) { innerDoc.addEventListener('mouseup', onUpInner); }
      document.addEventListener('mouseup', onUpOuter);
  }
  function onCanvasDragStart(ev) {
      // §6.2: dragging a CHOICE card reorders choices within its component —
      // the ONLY canvas native-DnD source that survives R7 U11a (intra-group,
      // parent-doc palette insert aside). The node-MOVE 'move:' branch is
      // RETIRED: every [data-question-id] node is draggable="false" now, so a
      // native node dragstart can never fire — canvas node moves flow through
      // the delegated pointer gesture (onFieldMoveMouseDown) instead.
      var cardEl = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
      if (cardEl && ev.dataTransfer) {
        var cardHost = cardEl.closest ? cardEl.closest('[data-question-id]') : null;
        if (cardHost && typeMeta(cardHost.getAttribute('data-component-type')).choice === true) {
          ev.dataTransfer.setData('text/plain', 'choice:' + cardHost.getAttribute('data-question-id') + ':' + cardEl.getAttribute('data-lg-choice'));
        }
      }
  }
  function onCanvasDragOver(ev) {
      ev.preventDefault();
      clearDropClasses();
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!el || !canvasOwns(el)) { dropHint = { qid: null, mode: 'append' }; return; }
      var qid = el.getAttribute('data-question-id');
      var type = el.getAttribute('data-component-type');
      var rect = el.getBoundingClientRect();
      var y = ev.clientY - rect.top;
      if (isContainerType(type) && y > rect.height * 0.25 && y < rect.height * 0.75) {
        dropHint = { qid: qid, mode: 'into' };
        el.className = withoutClasses(el.className, DROP_CLASSES) + ' studio-drop-into';
      } else if (y < rect.height / 2) {
        dropHint = { qid: qid, mode: 'before' };
        el.className = withoutClasses(el.className, DROP_CLASSES) + ' studio-drop-before';
      } else {
        dropHint = { qid: qid, mode: 'after' };
        el.className = withoutClasses(el.className, DROP_CLASSES) + ' studio-drop-after';
      }
  }
  function onCanvasDrop(ev) {
      ev.preventDefault();
      clearDropClasses();
      var data = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
      var hint = dropHint || { qid: null, mode: 'append' };
      dropHint = null;
      if (!data || data.indexOf(':') === -1) { return; }
      var kind = data.slice(0, data.indexOf(':'));
      var payload = data.slice(data.indexOf(':') + 1);
      var placed = null;
      if (kind === 'choice') {
        // payload = qid:choiceValue → reorder BEFORE the card dropped on.
        var sepAt = payload.indexOf(':');
        if (sepAt === -1) { return; }
        var cQid = payload.slice(0, sepAt);
        var fromValue = payload.slice(sepAt + 1);
        var targetCard = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
        var targetHost = targetCard && targetCard.closest ? targetCard.closest('[data-question-id]') : null;
        if (!targetCard || !targetHost || targetHost.getAttribute('data-question-id') !== cQid) { return; }
        var cRef = findRef(cQid);
        if (cRef) { reorderChoiceBefore(cRef.node, fromValue, targetCard.getAttribute('data-lg-choice')); }
        return;
      }
      if (kind === 'add') {
        // v3.1 audit-round G FIX 4: the 'add:' payload is a JSON envelope
        // {type, childTypes?, defaultProps?} (a bare type string — legacy /
        // non-brace — degrades to a childless insert). Parsed inline (the drop
        // handler owns its payload decode; keeps onCanvasDrop self-contained
        // for the vm-probe slice). childTypes+defaultProps are threaded so drag
        // == click == keyboard (a dragged Contact builds the 3-child Stack; a
        // dragged Divider is a Spacer variant:"line").
        // charCodeAt 123 is the JSON open-brace code — tested by code, never
        // a literal open-brace char in a string or comment (a literal one
        // would unbalance the vm-probe brace-count slicer for this handler).
        var addSpec = { type: payload };
        if (payload && payload.charCodeAt(0) === 123) {
          try { var addParsed = JSON.parse(payload); if (addParsed && addParsed.type) { addSpec = addParsed; } } catch (eAdd) { addSpec = { type: payload }; }
        }
        if (hint.mode === 'into') { placed = addComponentAt(addSpec.type, hint.qid, null, addSpec.childTypes, addSpec.defaultProps); }
        else if (hint.mode === 'before' || hint.mode === 'after') { placed = insertRelative(hint.qid, hint.mode, addSpec.type, addSpec.childTypes, addSpec.defaultProps); }
        else { placed = addComponentAt(addSpec.type, null, null, addSpec.childTypes, addSpec.defaultProps); }
        if (placed) { selectComponent(placed.question_id); }
      }
      // R7 U11a: the 'move' kind is RETIRED here — canvas node reorders no
      // longer ride native DnD (nodes are draggable="false"); the delegated
      // pointer gesture (onFieldMoveMouseDown → moveNodeTo) owns node moves
      // with the SAME before/into/after semantics this branch used to compute.
  }
  function onCanvasKeyDown(ev) {
      if (!selectedQuestionId) { return; }
      // §6.2 inline editing owns the keys: this flag skips keys typed
      // MID-edit; the session-TERMINATING Enter/Escape never reach here at
      // all — onKey stops their propagation at the element (finish() clears
      // the flag before the bubble arrives, so the flag alone could not stop
      // the cancelling Escape from ALSO walking the selection).
      if (inlineEditing) { return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moveWithin(selectedQuestionId, -1); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); moveWithin(selectedQuestionId, 1); }
      // §6.2: Del deletes the selection; Esc walks UP the ancestry.
      else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        deleteSelectedWithUndo(selectedQuestionId);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        var upRef = findRef(selectedQuestionId);
        selectComponent(upRef && upRef.parent ? upRef.parent.question_id : null);
      }
  }
  // ONE binder, two roots: the parent surface and (per load) the frame doc.
  function bindCanvasSurface(target) {
    if (!target || !target.addEventListener) { return; }
    target.addEventListener('click', onCanvasClick);
    target.addEventListener('dblclick', onCanvasDblClick);
    target.addEventListener('mousedown', onCanvasMouseDown);
    // R7 U11a: the ONE canvas move gesture, delegated on the surface for EVERY
    // node type (after onCanvasMouseDown so a container resize-handle press is
    // claimed first; onFieldMoveMouseDown skips [data-resize-handle] anyway).
    target.addEventListener('mousedown', onFieldMoveMouseDown);
    // dragstart/dragover/drop remain ONLY for (a) the parent-doc palette-tile
    // INSERT ('add:' — drag starts outside the iframe, no hang) and (b) intra-
    // group choice-card reorder ('choice:'). The node-MOVE branches ('move:')
    // are retired below — every canvas node is draggable="false" now.
    target.addEventListener('dragstart', onCanvasDragStart);
    target.addEventListener('dragover', onCanvasDragOver);
    target.addEventListener('drop', onCanvasDrop);
    target.addEventListener('keydown', onCanvasKeyDown);
  }
  if (canvasSurface) { bindCanvasSurface(canvasSurface); }
  // Bind the frame document exactly once per LOADED srcdoc document: the
  // 'load' listener catches a late load, the immediate call an already-loaded
  // one; the mount check skips the transient about:blank document.
  var canvasDocBound = null;
  function bindCanvasFrameDoc() {
    var doc = canvasFrameDoc();
    if (!doc || doc === canvasDocBound) { return; }
    if (!doc.getElementById || !doc.getElementById('lg-studio-canvas-render')) { return; }
    canvasDocBound = doc;
    bindCanvasSurface(doc);
    // DEV-66 height tracker: recompute when in-frame images load (capture —
    // img 'load' does not bubble). Bound once per LOADED document, like the
    // surface delegation above.
    doc.addEventListener('load', onFrameDocLoadCapture, true);
    applyCanvasDecoration();
    updateCanvasFrameViewport();
    updateCanvasFrameHeight();
  }
  (function () {
    var frame = canvasFrameEl();
    if (frame && frame.addEventListener) { frame.addEventListener('load', bindCanvasFrameDoc); }
    bindCanvasFrameDoc();
  })();

  // --- §6.1 canvas toolbar (always visible; clusters per the §6.5 matrix) --------
  var toolbarEl = document.querySelector('[data-studio-selection-toolbar]');
  function handleChoiceAct(act) {
    var node = selectedNode();
    if (!node || selectedChoiceValue === null) { return; }
    var value = String(selectedChoiceValue);
    var c = findChoice(node, value);
    if (!c) { return; }
    if (act === 'image') {
      // §6.4 image/icon swap: image grids open the media picker; icon/emoji
      // types prompt for the curated glyph.
      if (node.type === 'ImageCardAnswerGrid') {
        openMediaPicker({ qid: node.question_id, value: value });
      } else {
        var glyph = window.prompt('Icon or emoji character', c.icon || c.emoji || '');
        if (glyph === null) { return; }
        glyph = trimStr(glyph);
        if (glyph === '') { delete c.icon; delete c.emoji; }
        else { c.icon = glyph; delete c.emoji; }
        afterModelChange();
        renderChoiceEditor(node);
      }
      return;
    }
    if (act === 'label') {
      setInspectorTab('content');
      focusChoiceRow(value);
      return;
    }
    if (act === 'badge') {
      if (typeof c.badge === 'string' && c.badge !== '') { setChoiceField(node, value, 'badge', null); }
      else {
        var badgeText = window.prompt('Badge text', 'Recommended');
        if (badgeText === null || trimStr(badgeText) === '') { return; }
        setChoiceField(node, value, 'badge', trimStr(badgeText));
      }
      renderChoiceEditor(node);
      return;
    }
    if (act === 'disabled') {
      setChoiceField(node, value, 'disabled', c.disabled === true ? null : true);
      renderChoiceEditor(node);
      return;
    }
    if (act === 'duplicate') {
      var dup = duplicateChoice(node, value);
      if (dup) { selectChoice(node.question_id, String(dup.value)); }
      return;
    }
    if (act === 'delete') {
      removeChoiceFromNode(node, value);
      renderChoiceEditor(node);
      setScope(selectedQuestionId ? 'component' : 'section');
      return;
    }
    if (act === 'left') { moveChoice(node, value, -1); return; }
    if (act === 'right') { moveChoice(node, value, 1); return; }
  }
  if (toolbarEl) {
    toolbarEl.addEventListener('click', function (ev) {
      // §6.4 choice cluster acts (R5 D3: now inside the toolbar's "More"
      // popover — still a descendant of toolbarEl, delegation unaffected).
      var choiceBtn = ev.target && ev.target.closest ? ev.target.closest('[data-choice-act]') : null;
      if (choiceBtn) { handleChoiceAct(choiceBtn.getAttribute('data-choice-act')); return; }
      var chipBtn = ev.target && ev.target.closest ? ev.target.closest('[data-choice-value-chip]') : null;
      if (chipBtn && selectedChoiceValue !== null) {
        setInspectorTab('content');
        focusChoiceRow(String(selectedChoiceValue));
        return;
      }
      // R5 D3 (register S4-A3): the old toolbar's add-choice / auto-advance /
      // open-validation / searchable / card-style / slider-format / preset-
      // save branches were REMOVED from this delegated listener — the first
      // three controls are DELETED entirely (exact duplicates of Content-tab
      // controls); the last four MOVED to the Content/Style tabs (outside
      // toolbarEl's subtree) and now bind directly (see their own
      // addEventListener calls near presetApplyEl below).
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-studio-act]') : null;
      if (!btn) { return; }
      var act = btn.getAttribute('data-studio-act');
      // §6.1.3 undo/redo work with or without a selection.
      if (act === 'undo') { historyUndo(); return; }
      if (act === 'redo') { historyRedo(); return; }
      if (!selectedQuestionId) { return; }
      var out;
      if (act === 'move-up') { moveWithin(selectedQuestionId, -1); }
      else if (act === 'move-down') { moveWithin(selectedQuestionId, 1); }
      else if (act === 'duplicate') {
        out = duplicateNode(selectedQuestionId);
        if (out) { selectComponent(out.question_id); }
      }
      else if (act === 'delete') { deleteSelectedWithUndo(selectedQuestionId); }
      else if (act === 'add-before' || act === 'add-after') {
        var where = act === 'add-before' ? 'before' : 'after';
        if (pendingInsert && pendingInsert.where === where && pendingInsert.qid === selectedQuestionId) { pendingInsert = null; }
        else { pendingInsert = { qid: selectedQuestionId, where: where }; }
        updatePendingUi();
      }
      else if (act === 'group-stack') {
        out = wrapSelection(selectedQuestionId, 'Stack');
        if (out) { selectComponent(out.question_id); }
      }
      else if (act === 'group-cardpanel') {
        out = wrapSelection(selectedQuestionId, 'CardPanel');
        if (out) { selectComponent(out.question_id); }
      }
      // §6.1.5: Group into Grid / Columns + Ungroup (children splice up).
      else if (act === 'group-grid') {
        out = wrapSelection(selectedQuestionId, 'GridContainer');
        if (out) { selectComponent(out.question_id); }
      }
      else if (act === 'group-columns') {
        out = wrapSelection(selectedQuestionId, 'Columns');
        if (out) { selectComponent(out.question_id); }
      }
      else if (act === 'ungroup') {
        out = ungroupSelection(selectedQuestionId);
        if (out) { selectComponent(selectedQuestionId); }
      }
    });
  }
  // §6.1.4 canvas viewport toggle: Desktop 1280 / Mobile 375 — SERVER-rendered
  // via the existing preview viewport param.
  // §6.1 viewport segmented — ES5 mirror of the golden's vpSeg() (golden
  // :751-755); same hardcoded-literal idiom as segStyle (Appendix D).
  function vpSegStyle(active) {
    return active
      ? 'display:inline-flex;align-items:center;gap:6px;padding:5px 11px;font-size:12px;font-weight:700;color:#1B3A5C;background:#fff;border-radius:6px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.12);border:0'
      : 'display:inline-flex;align-items:center;gap:6px;padding:5px 11px;font-size:12px;font-weight:600;color:#8A93A3;cursor:pointer;border:0';
  }
  var canvasViewportBtns = document.querySelectorAll('[data-canvas-viewport]');
  var cvb;
  for (cvb = 0; cvb < canvasViewportBtns.length; cvb++) {
    canvasViewportBtns[cvb].addEventListener('click', function () {
      canvasViewport = this.getAttribute('data-canvas-viewport') === 'mobile' ? 'mobile' : 'desktop';
      var all = document.querySelectorAll('[data-canvas-viewport]');
      var k, isOn;
      for (k = 0; k < all.length; k++) {
        isOn = all[k] === this;
        all[k].setAttribute('style', vpSegStyle(isOn));
        all[k].setAttribute('aria-pressed', isOn ? 'true' : 'false');
      }
      // DEV-66: the frame element IS the viewport — size it FIRST so the
      // design's @media rules evaluate at the real width (375/1280), then
      // fetch the server render for that viewport.
      updateCanvasFrameViewport();
      renderCanvasNow();
    });
  }
  // §6.1.7 text cluster: type role conversion.
  var textRoleEl = document.querySelector('[data-text-role]');
  if (textRoleEl) {
    textRoleEl.addEventListener('change', function () {
      if (!selectedQuestionId) { return; }
      var ok = convertTextRole(selectedQuestionId, this.value);
      if (ok) { selectComponent(selectedQuestionId); }
      else {
        var cur = selectedNode();
        if (cur) { this.value = cur.type; }
      }
    });
  }
  // §5.6 "The Accept-swap rule" — the Accept dropdown selects the concrete
  // stored type; re-select afterward so the breadcrumb/toolbar/badge reflect
  // the new type immediately (matching the text-role handler's own idiom).
  var acceptEl = document.querySelector('[data-toolbar-accept]');
  if (acceptEl) {
    acceptEl.addEventListener('change', function () {
      if (!selectedQuestionId) { return; }
      var aNode = selectedNode();
      if (aNode && setAcceptFormat(aNode, this.value)) { selectComponent(selectedQuestionId); }
    });
  }

  // --- inspector + drawer tab switching ----------------------------------------------
  var inspectorTabs = document.querySelectorAll('[data-studio-inspector-tab]');
  var it;
  for (it = 0; it < inspectorTabs.length; it++) {
    inspectorTabs[it].addEventListener('click', function () {
      setInspectorTab(this.getAttribute('data-studio-inspector-tab'));
    });
  }
  function setDrawerTab(key) {
    var tabs = document.querySelectorAll('[data-studio-drawer-tab]');
    var panels = document.querySelectorAll('[data-studio-drawer-panel]');
    var i, k, isMinor, base;
    for (i = 0; i < tabs.length; i++) {
      k = tabs[i].getAttribute('data-studio-drawer-tab');
      // §2.1 bottom-drawer bar (golden 370-387): the 3 golden pills carry
      // 'studio-drawer-tab'; the non-golden "Design overrides" 4th control
      // carries 'studio-drawer-tab-minor' instead — read BEFORE overwriting
      // so each tab keeps its own visual family across every re-render.
      isMinor = tabs[i].className.indexOf('studio-drawer-tab-minor') !== -1;
      base = isMinor ? 'studio-tab studio-drawer-tab-minor' : 'studio-tab studio-drawer-tab';
      tabs[i].className = k === key ? base + ' active' : base;
      tabs[i].setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
    for (i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-studio-drawer-panel') !== key;
    }
  }
  // §2.1 bottom-drawer "Expand" (golden :385): toggles the drawer between its
  // default compact height and a taller working view — presentation-only,
  // no model change.
  var drawerExpandBtn = document.querySelector('[data-studio-drawer-expand]');
  if (drawerExpandBtn) {
    drawerExpandBtn.addEventListener('click', function () {
      var drawerEl = document.querySelector('[data-studio-drawer]');
      if (!drawerEl) { return; }
      var expanded = drawerEl.className.indexOf('studio-drawer-expanded') !== -1;
      drawerEl.className = expanded ? 'studio-drawer' : 'studio-drawer studio-drawer-expanded';
      this.setAttribute('aria-pressed', expanded ? 'false' : 'true');
    });
  }
  // R5 D4 (register S4-A5/A6, operator decision 4): the QA-tools toggle —
  // default OFF (unchecked, matching the SSR'd hidden attribute on every
  // [data-qa-tools-only] block) — un-hides ALL of them together: the Preview
  // dev-console's design-picker/state-simulator/dependency-JSON/events-log/
  // events-probe-iframe AND the drawer's "Design overrides" 4th tab. If the
  // Design tab happens to be ACTIVE when the toggle is switched back off,
  // fall back to the Preview tab so no orphaned/hidden panel stays "active".
  var qaToggle = document.getElementById('lg-qa-tools-toggle');
  if (qaToggle) {
    qaToggle.addEventListener('change', function () {
      var on = this.checked;
      var qaEls = document.querySelectorAll('[data-qa-tools-only]');
      var qi;
      for (qi = 0; qi < qaEls.length; qi++) { qaEls[qi].hidden = !on; }
      if (!on) {
        var designTabBtn = document.querySelector('[data-studio-drawer-tab="design"]');
        if (designTabBtn && designTabBtn.className.indexOf('active') !== -1) { setDrawerTab('preview'); }
      }
    });
  }
  var drawerTabs = document.querySelectorAll('[data-studio-drawer-tab]');
  var dt;
  for (dt = 0; dt < drawerTabs.length; dt++) {
    drawerTabs[dt].addEventListener('click', function () {
      setDrawerTab(this.getAttribute('data-studio-drawer-tab'));
    });
  }
  // R5 D6 (register S4-A11, golden :627-721): "Manage theme ->" (Style tab +
  // drawer bar) opens the Themes manager as an IN-PAGE OVERLAY (an <iframe>
  // embedding the existing /admin/leadgen/themes?embed=1 route) instead of
  // navigating away — the golden's own interaction. The standalone route
  // still works for deep links (bare /admin/leadgen/themes).
  function openThemesOverlay() {
    var overlay = document.querySelector('[data-themes-overlay]');
    var frame = document.getElementById('lg-themes-overlay-frame');
    if (!overlay || !frame) { return; }
    var pid = state.public_id;
    var src = pid ? ('/admin/leadgen/themes?embed=1&from=' + encodeURIComponent(pid)) : '/admin/leadgen/themes?embed=1';
    frame.setAttribute('src', src);
    overlay.hidden = false;
  }
  function closeThemesOverlay() {
    var overlay = document.querySelector('[data-themes-overlay]');
    var frame = document.getElementById('lg-themes-overlay-frame');
    if (overlay) { overlay.hidden = true; }
    if (frame) { frame.setAttribute('src', 'about:blank'); }
  }
  var manageThemeLinks = document.querySelectorAll('[data-open-manage-theme], [data-studio-manage-theme-link]');
  var mtl;
  for (mtl = 0; mtl < manageThemeLinks.length; mtl++) {
    manageThemeLinks[mtl].addEventListener('click', function (ev) {
      ev.preventDefault();
      openThemesOverlay();
    });
  }
  var themesOverlayBackdrop = document.querySelector('[data-themes-overlay-backdrop]');
  if (themesOverlayBackdrop) { themesOverlayBackdrop.addEventListener('click', closeThemesOverlay); }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== window.location.origin) { return; }
    if (ev.data && ev.data.source === 'lg-themes-embed' && ev.data.action === 'close') {
      closeThemesOverlay();
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') { return; }
    var overlay = document.querySelector('[data-themes-overlay]');
    if (overlay && !overlay.hidden) { closeThemesOverlay(); return; }
    var morePanelEsc = document.querySelector('[data-studio-more-panel]');
    if (morePanelEsc && !morePanelEsc.hidden) { closeMorePanel(); }
  });
  // R5 D3 (register S4-A3): the canvas toolbar's compact "More actions"
  // popover — structure/choice clusters relocated here (see
  // renderCanvasToolbar). Toggle on click; close on outside-click, Escape
  // (above), or when the selection stops having anything to show
  // (updateCanvasToolbar's hasMore check).
  function closeMorePanel() {
    var panel = document.querySelector('[data-studio-more-panel]');
    var toggle = document.querySelector('[data-studio-more-toggle]');
    if (panel) { panel.hidden = true; }
    if (toggle) { toggle.setAttribute('aria-expanded', 'false'); }
  }
  var moreToggleBtn = document.querySelector('[data-studio-more-toggle]');
  if (moreToggleBtn) {
    moreToggleBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var panel = document.querySelector('[data-studio-more-panel]');
      if (!panel) { return; }
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      this.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
  }
  document.addEventListener('click', function (ev) {
    var panel = document.querySelector('[data-studio-more-panel]');
    if (!panel || panel.hidden) { return; }
    var withinPanel = ev.target && ev.target.closest && ev.target.closest('[data-studio-more-panel]');
    var onToggle = ev.target && ev.target.closest && ev.target.closest('[data-studio-more-toggle]');
    if (!withinPanel && !onToggle) { closeMorePanel(); }
  });
  var chipEl = document.querySelector('[data-studio-validation-chip]');
  if (chipEl) { chipEl.addEventListener('click', function () { setDrawerTab('validation'); }); }
  var openMapping = document.querySelector('[data-studio-open-mapping-drawer]');
  if (openMapping) {
    openMapping.addEventListener('click', function () {
      setDrawerTab('mapping');
      // R4a S3-3: the tab switch alone is a perceptual no-op from the Offers
      // tab (the drawer is a separate below-the-fold region) — scroll it
      // into view, pulse the panel (~1.5s, CSS studio-mapping-pulse), and
      // move focus so the operator SEES something happen.
      var drawerEl = document.querySelector('[data-studio-drawer]');
      if (drawerEl && drawerEl.scrollIntoView) { drawerEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      var mappingPanel = document.querySelector('[data-studio-drawer-panel="mapping"]');
      if (mappingPanel) {
        if (mappingPanel.className.indexOf('studio-mapping-pulse') === -1) {
          mappingPanel.className = mappingPanel.className + ' studio-mapping-pulse';
        }
        setTimeout(function () {
          mappingPanel.className = mappingPanel.className.replace(/\s*studio-mapping-pulse\s*/, ' ').replace(/\s+$/, '');
        }, 1600);
      }
      var mappingTabBtn = document.querySelector('[data-studio-drawer-tab="mapping"]');
      if (mappingTabBtn && mappingTabBtn.focus) { mappingTabBtn.focus(); }
    });
  }
  // §12.3: the preview-drawer overlay toggle repaints the canvas decoration.
  var overlayToggle = document.querySelector('[data-studio-overlay-toggle]');
  if (overlayToggle) {
    overlayToggle.addEventListener('click', function () {
      mappingOverlayOn = !mappingOverlayOn;
      this.setAttribute('aria-pressed', mappingOverlayOn ? 'true' : 'false');
      this.className = mappingOverlayOn ? 'btn btn-sm btn-outline active' : 'btn btn-sm btn-outline';
      applyCanvasDecoration();
    });
  }
  // R4a E3-NEW-4: the static href is now the real (never-dead) auctions
  // list; JS upgrades it to the resolved 0/1/many destination on click.
  var openAuctionRulesLink = document.querySelector('[data-open-auction-rules]');
  if (openAuctionRulesLink) {
    openAuctionRulesLink.addEventListener('click', function (ev) {
      ev.preventDefault();
      openAuctionRulesNav();
    });
  }

  // --- inspector input wiring: every edit flows back into the selected node ------------
  var fieldEls = document.querySelectorAll('[data-inspector-field]');
  var fe;
  for (fe = 0; fe < fieldEls.length; fe++) {
    fieldEls[fe].addEventListener('input', function () { collectInspectorField(this); });
    fieldEls[fe].addEventListener('change', function () { collectInspectorField(this); });
  }
  var ovEls = document.querySelectorAll('[data-inspector-override]');
  var oe;
  for (oe = 0; oe < ovEls.length; oe++) {
    ovEls[oe].addEventListener('input', function () { collectInspectorOverride(this); });
    ovEls[oe].addEventListener('change', function () { collectInspectorOverride(this); });
  }
  var vpropEls = document.querySelectorAll('[data-inspector-vprop]');
  var ve;
  for (ve = 0; ve < vpropEls.length; ve++) {
    vpropEls[ve].addEventListener('input', function () { collectValidationProp(this); });
    vpropEls[ve].addEventListener('change', function () { collectValidationProp(this); });
  }
  // §9 Maps tab controls: the enabled toggle re-collects the whole {enabled,
  // jobs} object (turning ON seeds all-false jobs — triggers the zero-job
  // banner immediately per §9.3); each job checkbox re-collects just itself.
  var mapsToggleEl = document.querySelector('[data-maps-enabled-toggle]');
  if (mapsToggleEl) { mapsToggleEl.addEventListener('change', collectMapsToggle); }
  var mapsJobEls = document.querySelectorAll('[data-maps-job]');
  var mj;
  for (mj = 0; mj < mapsJobEls.length; mj++) {
    mapsJobEls[mj].addEventListener('change', function () { collectMapsJob(this); });
  }
  // R4b (S3-7): each sibling-fill select re-collects just its own slot.
  var mapsFillEls = document.querySelectorAll('[data-maps-fill-slot]');
  var mf;
  for (mf = 0; mf < mapsFillEls.length; mf++) {
    mapsFillEls[mf].addEventListener('change', function () { collectMapsFill(this); });
  }

  // §8.5 Style tab: Width/Height presets, Reset, Corners, Border color.
  var widthPresetEls = document.querySelectorAll('[data-set-width]');
  var wpi;
  for (wpi = 0; wpi < widthPresetEls.length; wpi++) {
    widthPresetEls[wpi].addEventListener('click', function () { setWidthPreset(this.getAttribute('data-set-width')); });
  }
  var heightPresetEls = document.querySelectorAll('[data-set-height]');
  var hpi;
  for (hpi = 0; hpi < heightPresetEls.length; hpi++) {
    heightPresetEls[hpi].addEventListener('click', function () { setHeightPreset(this.getAttribute('data-set-height')); });
  }
  var resetWidthEl = document.querySelector('[data-reset-width]');
  if (resetWidthEl) { resetWidthEl.addEventListener('click', resetWidthCustom); }
  var resetHeightEl = document.querySelector('[data-reset-height]');
  if (resetHeightEl) { resetHeightEl.addEventListener('click', resetHeightCustom); }
  var cornersEls = document.querySelectorAll('[data-set-corners]');
  var cni;
  for (cni = 0; cni < cornersEls.length; cni++) {
    cornersEls[cni].addEventListener('click', function () { setNodeCorners(this.getAttribute('data-set-corners')); });
  }
  var borderColorEls = document.querySelectorAll('[data-set-border-color]');
  var bci;
  for (bci = 0; bci < borderColorEls.length; bci++) {
    borderColorEls[bci].addEventListener('click', function () { setNodeBorderColor(this.getAttribute('data-set-border-color')); });
  }
  var textBlockRoleEl = document.querySelector('[data-text-block-role]');
  if (textBlockRoleEl) { textBlockRoleEl.addEventListener('change', collectTextBlockRole); }

  // v3.1 R3b deliverable 4: ImageBlock's source toggle + media picker/thumb.
  var imageBlockSourceEls = document.querySelectorAll('[data-set-imageblock-source]');
  var ibsi;
  for (ibsi = 0; ibsi < imageBlockSourceEls.length; ibsi++) {
    imageBlockSourceEls[ibsi].addEventListener('click', function () { setImageBlockSource(this.getAttribute('data-set-imageblock-source')); });
  }
  var imageBlockMediaInput = document.getElementById('lg-imageblock-media');
  var imageBlockThumb = document.querySelector('[data-imageblock-thumb]');
  if (imageBlockMediaInput && imageBlockThumb) {
    var refreshImageBlockThumb = function () { setChoiceThumb(imageBlockThumb, imageBlockMediaInput.value); };
    imageBlockMediaInput.addEventListener('input', refreshImageBlockThumb);
    imageBlockMediaInput.addEventListener('change', refreshImageBlockThumb);
  }
  var imageBlockChooseBtn = document.querySelector('[data-imageblock-media-choose]');
  if (imageBlockChooseBtn && imageBlockMediaInput) {
    imageBlockChooseBtn.addEventListener('click', function () {
      openMediaPicker({
        input: imageBlockMediaInput,
        onpick: function () {
          if (imageBlockThumb) { setChoiceThumb(imageBlockThumb, imageBlockMediaInput.value); }
          collectInspectorField(imageBlockMediaInput);
        },
      });
    });
  }

  // §8.3 Content tab: dedicated Accept select (reuses setAcceptFormat — the
  // SAME §5.6 Accept-swap rule the canvas toolbar's data-toolbar-accept
  // already wires) + the When-answered segmented (reuses setContinueMode —
  // the SAME section-wide control the question strip already wires).
  var inspectorAcceptEl = document.querySelector('[data-inspector-accept]');
  if (inspectorAcceptEl) {
    inspectorAcceptEl.addEventListener('change', function () {
      var node = selectedNode();
      if (node) { setAcceptFormat(node, this.value); populateInspector(); applyCanvasDecoration(); }
    });
  }
  var contentModeEls = document.querySelectorAll('[data-set-continue-mode]');
  var cmi;
  for (cmi = 0; cmi < contentModeEls.length; cmi++) {
    contentModeEls[cmi].addEventListener('click', function () { setContinueMode(this.getAttribute('data-set-continue-mode')); populateInspector(); });
  }

  // §8.4 "Hide in this question" (headline/subheadline) — reuses the
  // existing removeNode mechanism (the bound TEXT lives in headline_text/
  // subheadline_text, untouched by removing the NODE; "Show" already
  // re-inserts via insertBoundNodeAtTop, wired elsewhere).
  var boundHideEl = document.querySelector('[data-bound-hide]');
  if (boundHideEl) {
    boundHideEl.addEventListener('click', function () {
      var node = selectedNode();
      if (node) { removeNode(node.question_id); }
    });
  }
  // §8.3 "Review mapping →" — switches the inspector to the Offers tab.
  var connectOffersReviewEl = document.querySelector('[data-connect-offers-review]');
  if (connectOffersReviewEl) { connectOffersReviewEl.addEventListener('click', function () { setInspectorTab('offers'); }); }

  // §8.6 Rules: "+ Add a condition" reveals the picker (UI-only, until a
  // field is actually chosen); "Remove condition" clears the stored
  // conditional and returns to "Always show".
  var rulesAddBtn = document.querySelector('[data-rules-add-condition]');
  if (rulesAddBtn) {
    rulesAddBtn.addEventListener('click', function () { rulesFieldsRevealed = true; renderRulesFieldsVisibility(true); });
  }
  var rulesRemoveBtn = document.querySelector('[data-rules-remove-condition]');
  if (rulesRemoveBtn) {
    rulesRemoveBtn.addEventListener('click', function () {
      var node = selectedNode();
      if (node) { delete node.conditional; }
      rulesFieldsRevealed = false;
      populateConditional(node);
      renderConditionSentences(node);
      renderRulesFieldsVisibility(false);
      afterModelChange();
    });
  }

  // §8.8 Advanced: a persistent disclosure (collapsed by default, re-locks
  // per selection — setAdvancedOpen(false) in populateInspector).
  var advancedToggleEl = document.querySelector('[data-studio-advanced-toggle]');
  if (advancedToggleEl) { advancedToggleEl.addEventListener('click', function () { setAdvancedOpen(!advancedOpen); }); }

  var condEls = document.querySelectorAll('[data-inspector-cond]');
  var ce;
  for (ce = 0; ce < condEls.length; ce++) {
    condEls[ce].addEventListener('input', collectConditional);
    condEls[ce].addEventListener('change', collectConditional);
  }
  // FIX 7: the "Require this component IF" pickers (props.requiredWhen).
  var reqCondEls = document.querySelectorAll('[data-inspector-reqcond]');
  var rce;
  for (rce = 0; rce < reqCondEls.length; rce++) {
    reqCondEls[rce].addEventListener('input', collectRequiredWhen);
    reqCondEls[rce].addEventListener('change', collectRequiredWhen);
  }
  // §5.5 (FIX 8a/8b): the typed default controls.
  var defaultEls = document.querySelectorAll('[data-default-control]');
  var dce;
  for (dce = 0; dce < defaultEls.length; dce++) {
    defaultEls[dce].addEventListener('input', function () { collectDefaultControl(this); });
    defaultEls[dce].addEventListener('change', function () { collectDefaultControl(this); });
  }
  var containerEls = document.querySelectorAll('[data-container-prop]');
  var cpe;
  for (cpe = 0; cpe < containerEls.length; cpe++) {
    containerEls[cpe].addEventListener('input', function () { collectContainerProp(this); });
    containerEls[cpe].addEventListener('change', function () { collectContainerProp(this); });
  }
  var ctaEls = document.querySelectorAll('[data-container-cta]');
  var cte;
  for (cte = 0; cte < ctaEls.length; cte++) {
    ctaEls[cte].addEventListener('input', collectContainerCta);
    ctaEls[cte].addEventListener('change', collectContainerCta);
  }
  var choiceAdd = document.getElementById('lg-choice-add');
  if (choiceAdd) {
    choiceAdd.addEventListener('click', function () {
      var c = choiceContainer();
      if (c) { c.appendChild(buildChoiceRow({}, false, selectedNode())); }
    });
  }
  // B9 §6.4 grouping controls: the three [data-choicedisplay] inputs fold into
  // the model through the SAME collect path the choice rows use — an operator
  // whose LAST edit is the Other-group toggle/label must not lose it on save
  // (order independence; collectChoices reads rows + group controls together).
  function wireChoiceDisplayControls() {
    var els = document.querySelectorAll('[data-choicedisplay]');
    var i;
    for (i = 0; i < els.length; i++) {
      els[i].addEventListener('change', collectChoices);
      els[i].addEventListener('input', collectChoices);
    }
  }
  wireChoiceDisplayControls();
  var bulkApply = document.getElementById('lg-choice-bulk-apply');
  if (bulkApply) { bulkApply.addEventListener('click', applyBulkPaste); }
  var jsonApply = document.getElementById('lg-node-json-apply');
  if (jsonApply) { jsonApply.addEventListener('click', applyNodeJson); }
  // §7.3: the explicit "Edit raw…" confirm unlocks the read-only raw view.
  var jsonEdit = document.getElementById('lg-node-json-edit');
  if (jsonEdit) { jsonEdit.addEventListener('click', armRawEdit); }
  // §9.4 role rows: Reset to inherited + Convert-legacy delegation.
  var inspectorEl = document.querySelector('[data-studio-inspector]');
  if (inspectorEl) {
    inspectorEl.addEventListener('click', function (ev) {
      var resetBtn = ev.target && ev.target.closest ? ev.target.closest('[data-override-reset]') : null;
      if (resetBtn) { resetOverride(resetBtn.getAttribute('data-override-reset')); return; }
      var convertBtn = ev.target && ev.target.closest ? ev.target.closest('[data-override-convert]') : null;
      if (convertBtn) { convertLegacyOverride(convertBtn.getAttribute('data-override-convert')); return; }
    });
  }
  // §6.6: the Design-tab saved-presets dropdown (apply-merge + provenance) +
  // the toolbar apply select.
  var presetSelectEl = document.querySelector('[data-preset-select]');
  if (presetSelectEl) {
    presetSelectEl.addEventListener('change', function () {
      var node = selectedNode();
      if (!node) { return; }
      var v = trimStr(this.value);
      if (v === '') {
        // "(none)" clears the provenance name only — applied values stay.
        delete node.design_preset;
        afterModelChange();
        return;
      }
      var preset = presetByName(v);
      if (preset === null) { return; }
      if (!applyPreset(node, preset)) { this.value = node.design_preset || ''; return; }
      populateInspector();
    });
  }
  var presetApplyEl = document.querySelector('[data-preset-apply]');
  if (presetApplyEl) {
    presetApplyEl.addEventListener('change', function () {
      var node = selectedNode();
      var v = trimStr(this.value);
      this.value = '';
      if (!node || v === '') { return; }
      var preset = presetByName(v);
      if (preset !== null && applyPreset(node, preset)) { populateInspector(); }
    });
  }
  // R5 D3 (register S4-A3 migration): these four controls MOVED out of the
  // canvas toolbar's delegated click listener (toolbarEl) into the Content/
  // Style tabs (outside the toolbar's DOM subtree) — each now gets its OWN
  // direct binding, the same idiom presetApplyEl/inspectorAcceptEl already
  // use, so relocation never depends on delegation scope.
  var presetSaveEl = document.querySelector('[data-preset-save]');
  if (presetSaveEl) { presetSaveEl.addEventListener('click', function () { savePresetFromSelection(); }); }
  var searchableBtnEl = document.querySelector('[data-toolbar-searchable]');
  if (searchableBtnEl) {
    searchableBtnEl.addEventListener('click', function () {
      var sNode = selectedNode();
      if (sNode) { toggleSearchableDropdown(sNode); }
    });
  }
  var cardStyleBtns = document.querySelectorAll('[data-card-style]');
  var csbi;
  for (csbi = 0; csbi < cardStyleBtns.length; csbi++) {
    cardStyleBtns[csbi].addEventListener('click', function () {
      // §5.6 "Cards" style segmented [Icon|Image|Plain]. Re-select (like the
      // Accept-swap handler) so the inspector scope header/tab set refresh
      // to the NEW type immediately — a type swap without a re-select would
      // leave the scope header showing the PRE-swap label until the next
      // unrelated selection change.
      var cNode = selectedNode();
      if (cNode && setCardStyle(cNode, this.getAttribute('data-card-style'))) { selectComponent(selectedQuestionId); }
    });
  }
  var sliderFormatBtnEl = document.querySelector('[data-toolbar-slider-format]');
  if (sliderFormatBtnEl) {
    sliderFormatBtnEl.addEventListener('click', function () {
      var rNode = selectedNode();
      if (rNode && toggleSliderFormat(rNode)) { selectComponent(selectedQuestionId); }
    });
  }
  // §9.5 Section-overrides drawer controls.
  var sectionRoleEls = document.querySelectorAll('[data-section-role], [data-section-columns-default], [data-section-gap-default]');
  var sre;
  for (sre = 0; sre < sectionRoleEls.length; sre++) {
    sectionRoleEls[sre].addEventListener('change', collectSectionOverrides);
  }
  // Media picker chrome.
  var mediaCloseBtn = document.getElementById('lg-media-picker-close');
  if (mediaCloseBtn) { mediaCloseBtn.addEventListener('click', closeMediaPicker); }
  var mediaUploadBtn = document.getElementById('lg-media-upload-btn');
  if (mediaUploadBtn) { mediaUploadBtn.addEventListener('click', uploadMediaFile); }
  // FIX 8c: the picker's AI-generation affordance (server-hidden when the
  // route is unavailable — §8.4).
  var mediaAiBtn = document.getElementById('lg-media-ai-generate');
  if (mediaAiBtn) { mediaAiBtn.addEventListener('click', generateMediaWithAi); }
  var mediaGridEl = document.getElementById('lg-media-picker-grid');
  if (mediaGridEl) {
    mediaGridEl.addEventListener('click', function (ev) {
      var pick = ev.target && ev.target.closest ? ev.target.closest('[data-media-pick]') : null;
      if (pick) { applyMediaPick(pick.getAttribute('data-media-pick')); }
    });
  }
  // §6.1.3 keyboard: ⌘Z / ⇧⌘Z (typing fields keep their native undo).
  document.addEventListener('keydown', function (ev) {
    if (!(ev.metaKey || ev.ctrlKey)) { return; }
    var k = ev.key ? String(ev.key).toLowerCase() : '';
    if (k !== 'z') { return; }
    var t = ev.target;
    var tag = t && t.tagName ? String(t.tagName).toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (t && t.isContentEditable)) { return; }
    ev.preventDefault();
    if (ev.shiftKey) { historyRedo(); } else { historyUndo(); }
  });
  // §5.3 mode 5: frame-picker wiring (Quote → Funnel → Variant + site).
  var framePickQuoteEl = document.querySelector('[data-frame-pick-quote]');
  if (framePickQuoteEl) {
    framePickQuoteEl.addEventListener('change', function () { onFramePickQuote(trimStr(this.value)); });
  }
  var framePickFunnelEl = document.querySelector('[data-frame-pick-funnel]');
  if (framePickFunnelEl) {
    framePickFunnelEl.addEventListener('change', function () {
      framePick.funnel = trimStr(this.value);
      framePick.variant = '';
      populateFramePickVariants();
      runPreview();
    });
  }
  var framePickVariantEl = document.querySelector('[data-frame-pick-variant]');
  if (framePickVariantEl) {
    framePickVariantEl.addEventListener('change', function () {
      framePick.variant = trimStr(this.value);
      runPreview();
    });
  }
  var framePickSiteEl = document.querySelector('[data-frame-pick-site]');
  if (framePickSiteEl) {
    framePickSiteEl.addEventListener('change', function () {
      framePick.site = trimStr(this.value);
      runPreview();
    });
  }

  // --- Desktop/Mobile preview (slice-C wiring, byte-compatible hooks) -------------------
  var previewViewport = 'desktop';
  var simState = 'default';

  // R4a E3-S3: invalid input here previously parsed silently to {} — the
  // error is now surfaced inline (still behind the future "QA tools" toggle
  // this whole Preview panel lives behind, register S4-A5). Plain words —
  // never the native parser message (it can say things like "unexpected
  // token", and never the word this admin's own glossary gate bans outside
  // the Advanced surface).
  function sampleAnswers() {
    var el = document.getElementById('lg-dependency-answers');
    var errEl = document.querySelector('[data-dependency-answers-error]');
    if (!el) { return {}; }
    var t = trimStr(el.value);
    if (t === '') { if (errEl) { errEl.hidden = true; } return {}; }
    try {
      var parsed = JSON.parse(t);
      if (errEl) { errEl.hidden = true; }
      return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Sample answers must be a valid object — check for a missing quote, comma, or bracket.'; }
      return {};
    }
  }
  function renderDependencyStatus(dep) {
    var el = document.querySelector('[data-dependency-status]');
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    if (!dep) { el.setAttribute('data-continue-blocked', 'false'); return; }
    var visible = dep.visible_question_ids || [];
    var blocking = dep.blocking_question_ids || [];
    var msg = 'Visible: ' + visible.length + ' component(s). ';
    msg = msg + (dep.continue_blocked ? ('Continue BLOCKED — required: ' + blocking.join(', ')) : 'Continue allowed.');
    el.appendChild(document.createTextNode(msg));
    el.setAttribute('data-continue-blocked', dep.continue_blocked ? 'true' : 'false');
  }
  function runPreview() {
    var frame = document.getElementById('lg-preview-frame');
    var errEl = document.getElementById('lg-preview-error');
    if (errEl) { errEl.hidden = true; }
    clearEventsList();
    // §9.1: request the runtime-hydrated events document alongside the plain
    // markup — the iframe loads the REAL bundle in preview mode and the
    // "events that would fire" panel receives its postMessage stream.
    var headlineEl = document.getElementById('lg-section-headline');
    var requestBody = {
      content_json: JSON.stringify(state.content),
      viewport: previewViewport,
      sim: { state: simState },
      runtime: true,
      headline: headlineEl ? headlineEl.value : '',
      continue_mode: state.continue_mode || 'button',
      address_validation_enabled: !!state.address_validation_enabled
    };
    if (state.public_id) { requestBody.section_public_id = state.public_id; }
    if (simState !== 'default') { requestBody.sim.answers = sampleAnswers(); }
    // §5.3 mode 5: a picked funnel layout rides the LANDED frame_context param —
    // the unit renders inside that funnel's effective frame (13 §13.4).
    var frameCtx = frameContextBody();
    if (frameCtx !== null) { requestBody.frame_context = frameCtx; }
    var designSel = document.getElementById('lg-preview-design');
    if (designSel && trimStr(designSel.value) !== '') { requestBody.design_id = trimStr(designSel.value); }
    // §10.6 "Preview theme" switcher (Phase A's additive theme_id preview
    // param) — absent/blank selection previews the default (Navy).
    var themeSel = document.getElementById('lg-preview-theme');
    if (themeSel && trimStr(themeSel.value) !== '') { requestBody.theme_id = trimStr(themeSel.value); }
    fetch('/api/admin/leadgen/sections/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(requestBody)
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.preview) {
        if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Preview failed'; }
        return;
      }
      if (frame) {
        frame.className = previewViewport === 'mobile' ? 'lg-preview-frame lg-preview-frame-mobile' : 'lg-preview-frame';
        var html = res.body.preview.html || (previewViewport === 'mobile' ? res.body.preview.mobile : res.body.preview.desktop);
        var eventsDoc = res.body.preview.events_html || '';
        var staticDoc = res.body.preview.static_html || '';
        var probe = document.getElementById('lg-events-probe-frame');
        if (staticDoc !== '') {
          // §9.2/§14.9: a NON-default sim is a server-rendered STILL — the
          // main document carries NO runtime script (hydration would re-apply
          // dependency visibility from an empty answer store and re-hide the
          // sim's reveal). The §8.9 events stream keeps flowing from the
          // SEPARATE runtime document in the hidden probe frame.
          frame.setAttribute('srcdoc', staticDoc);
          if (probe && eventsDoc !== '') { probe.setAttribute('srcdoc', eventsDoc); }
        } else {
          // Default state keeps hydration: the runtime events document when
          // the server returned one (§9.1); the plain css+markup srcdoc stays
          // the fallback (byte-compatible). The probe frame is parked so only
          // ONE runtime document streams events at a time.
          frame.setAttribute('srcdoc', eventsDoc !== '' ? eventsDoc : ('<style>' + res.body.preview.css + '</style>' + html));
          if (probe) { probe.removeAttribute('srcdoc'); }
        }
      }
      renderDependencyStatus(res.body.dependencies || null);
    }).catch(function () {
      if (errEl) { errEl.hidden = false; errEl.textContent = 'Preview request failed'; }
    });
  }
  var viewportBtns = document.querySelectorAll('[data-preview-viewport]');
  var vi;
  for (vi = 0; vi < viewportBtns.length; vi++) {
    viewportBtns[vi].addEventListener('click', function () {
      previewViewport = this.getAttribute('data-preview-viewport');
      var all = document.querySelectorAll('[data-preview-viewport]');
      var k;
      for (k = 0; k < all.length; k++) {
        var isActive = all[k] === this;
        all[k].className = isActive ? 'btn btn-sm btn-secondary active' : 'btn btn-sm btn-secondary';
        all[k].setAttribute('aria-pressed', isActive ? 'true' : 'false');
      }
      runPreview();
    });
  }
  var refreshBtn = document.getElementById('lg-preview-refresh');
  if (refreshBtn) { refreshBtn.addEventListener('click', runPreview); }
  var designPicker = document.getElementById('lg-preview-design');
  if (designPicker) { designPicker.addEventListener('change', runPreview); }
  var simBtns = document.querySelectorAll('[data-sim-state]');
  var si;
  for (si = 0; si < simBtns.length; si++) {
    simBtns[si].addEventListener('click', function () {
      var stateName = this.getAttribute('data-sim-state');
      simState = stateName;
      var panel = document.querySelector('[data-dependency-panel]');
      if (panel) { panel.hidden = (stateName === 'default'); }
      var all = document.querySelectorAll('[data-sim-state]');
      var k;
      for (k = 0; k < all.length; k++) {
        var on = all[k] === this;
        all[k].setAttribute('aria-pressed', on ? 'true' : 'false');
        all[k].className = on ? 'btn btn-sm btn-outline active' : 'btn btn-sm btn-outline';
      }
      runPreview();
    });
  }
  var depApply = document.getElementById('lg-dependency-apply');
  if (depApply) { depApply.addEventListener('click', runPreview); }
  var depAnswers = document.getElementById('lg-dependency-answers');
  if (depAnswers) { depAnswers.addEventListener('change', runPreview); }

  // --- §8.9/§9.1 events panel: the preview iframe runs the REAL bundle in
  // preview mode; would-fire events arrive as postMessage batches ------------
  function clearEventsList() {
    var list = document.querySelector('[data-studio-events-list]');
    if (list) { clearChildren(list); }
  }
  function appendPreviewEvents(events) {
    var list = document.querySelector('[data-studio-events-list]');
    if (!list || !events || !events.length) { return; }
    var i, ev, li, typeEl, rest;
    for (i = 0; i < events.length; i++) {
      ev = events[i] && typeof events[i] === 'object' ? events[i] : {};
      li = document.createElement('li');
      typeEl = document.createElement('span');
      typeEl.className = 'studio-event-type';
      typeEl.appendChild(document.createTextNode(String(ev.event_type || 'event')));
      li.appendChild(typeEl);
      rest = cloneJson(ev);
      delete rest.event_type;
      li.appendChild(document.createTextNode(' ' + JSON.stringify(rest)));
      li.setAttribute('data-event-type', String(ev.event_type || 'event'));
      list.appendChild(li);
    }
  }
  function onPreviewMessage(ev) {
    if (!ev) { return; }
    var data = ev.data;
    if (!data || typeof data !== 'object' || data.type !== 'lg-preview-event') { return; }
    // §9.1 origin gate: accept ONLY messages posted by the two runtime
    // documents that live in THIS island — the visible preview iframe or the
    // hidden events-probe iframe. A message from any other window (a sibling
    // tab, an embedded frame, an opener) is IGNORED even if it forges
    // data.type, so a foreign page can never inject rows into the events panel.
    var previewFrame = document.getElementById('lg-preview-frame');
    var probeFrame = document.getElementById('lg-events-probe-frame');
    var fromPreview = !!previewFrame && ev.source === previewFrame.contentWindow;
    var fromProbe = !!probeFrame && ev.source === probeFrame.contentWindow;
    if (!fromPreview && !fromProbe) { return; }
    appendPreviewEvents(data.events || []);
  }
  window.addEventListener('message', onPreviewMessage);
  var eventsClearBtn = document.querySelector('[data-studio-events-clear]');
  if (eventsClearBtn) { eventsClearBtn.addEventListener('click', clearEventsList); }

  // --- §8.2 Activity/Vertical dropdowns (E1) ---------------------------------
  function fetchItems(url, cb) {
    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) { cb((j && j.items) || []); })
      .catch(function () { cb([]); });
  }
  // R5 D5 (register S4-A8/B8): the empty-state placeholder text is a
  // parameter, not a hardcoded generic glyph-dash — matches the SSR-side
  // savedOption() choice (renderStudioSettings) so a live client-side
  // refresh (this function, called on every page load) never re-introduces
  // the golden-never-depicts "— pick —" copy the R5 purge removed.
  // R5 D5 (register S4-A8/B8): the pill wrapper's populated-vs-empty visual
  // state (data-pair-empty + the dashed/muted vs solid/white styling,
  // renderStudioSettings) is set ONCE at SSR time from the loaded value —
  // this refreshes it live whenever the SELECT's value changes by ANY path
  // (server repopulate, a user pick, or "+New…"), so the pill never goes
  // visually stale (e.g. still showing the dashed empty-state border after
  // the operator has actually picked an activity).
  function refreshPairPillState(sel) {
    if (!sel) { return; }
    var wrap = sel.closest ? sel.closest('.studio-pair') : null;
    if (!wrap) { return; }
    var empty = trimStr(sel.value) === '';
    wrap.setAttribute('data-pair-empty', empty ? 'true' : 'false');
    wrap.style.background = empty ? '${STUDIO_COLOR.issuesChipBg}' : '${STUDIO_COLOR.white}';
    wrap.style.borderStyle = empty ? 'dashed' : 'solid';
    sel.style.color = empty ? '${STUDIO_COLOR.faint}' : 'inherit';
  }
  function populateOptionSelect(sel, items, current, placeholderLabel) {
    if (!sel) { return; }
    clearChildren(sel);
    var values = items.slice();
    if (current !== '' && values.indexOf(current) === -1) { values.unshift(current); }
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = placeholderLabel;
    sel.appendChild(blank);
    var i, o;
    for (i = 0; i < values.length; i++) {
      o = document.createElement('option');
      o.value = values[i];
      o.textContent = values[i];
      sel.appendChild(o);
    }
    sel.value = current;
    refreshPairPillState(sel);
  }
  var activitySel = document.getElementById('lg-section-activity');
  var verticalSel = document.getElementById('lg-section-vertical');
  function loadActivities() {
    if (!activitySel) { return; }
    fetchItems('/api/admin/leadgen/activities', function (items) {
      populateOptionSelect(activitySel, items, activitySel.value, 'Choose an activity');
    });
  }
  function loadVerticals() {
    if (!verticalSel) { return; }
    var activity = activitySel ? trimStr(activitySel.value) : '';
    var url = '/api/admin/leadgen/verticals' + (activity === '' ? '' : '?activity=' + encodeURIComponent(activity));
    fetchItems(url, function (items) {
      populateOptionSelect(verticalSel, items, verticalSel.value, 'Choose a vertical');
    });
  }
  // "+ New activity…" / "+ New vertical…" — allow-create ONLY behind the §8.2
  // explicit confirm; never silent free text.
  function promptNewSharedValue(kind, sel, after) {
    if (!sel) { return; }
    var v = trimStr(window.prompt('New ' + kind + ' name'));
    if (v === '') { return; }
    if (!window.confirm("No Offers exist for '" + v + "' yet. Create the " + kind + ' anyway?')) { return; }
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    sel.appendChild(o);
    sel.value = v;
    refreshPairPillState(sel);
    markDirty();
    if (after) { after(v); }
  }
  var newActivityBtn = document.querySelector('[data-studio-new-activity]');
  if (newActivityBtn) {
    newActivityBtn.addEventListener('click', function () {
      promptNewSharedValue('activity', activitySel, function () {
        if (verticalSel) { verticalSel.value = ''; }
        loadVerticals();
        // R4a E3-S5: parity with the activitySel 'change' handler below —
        // creating a new activity changes the Activity/Vertical pair just
        // like picking one does, so the stale-offers note must refresh too.
        renderOffersStaleNote();
      });
    });
  }
  var newVerticalBtn = document.querySelector('[data-studio-new-vertical]');
  if (newVerticalBtn) {
    newVerticalBtn.addEventListener('click', function () {
      // R4a E3-S5: parity with the verticalSel 'change' handler below.
      promptNewSharedValue('vertical', verticalSel, function () { renderOffersStaleNote(); });
    });
  }
  if (activitySel) {
    // §8.2: changing Activity RESETS Vertical (the vertical list is derived
    // from the selected activity).
    activitySel.addEventListener('change', function () {
      refreshPairPillState(activitySel);
      if (verticalSel) { verticalSel.value = ''; }
      loadVerticals();
      renderOffersStaleNote();
    });
  }
  if (verticalSel) {
    verticalSel.addEventListener('change', function () {
      refreshPairPillState(verticalSel);
      renderOffersStaleNote();
    });
  }

  // --- §8.7 Offer mapping panel (E2) — model core ------------------------------
  var offersData = null;
  var openMapOfferId = null;
  function offersList() { return (offersData && offersData.offers) || []; }
  function offerById(offerId) {
    var list = offersList(), i;
    for (i = 0; i < list.length; i++) { if (list[i].id === offerId) { return list[i]; } }
    return null;
  }
  function answerFieldOf(offer, path) {
    var fields = (offer && offer.answer_fields) || [];
    var i;
    for (i = 0; i < fields.length; i++) { if (fields[i].path === path) { return fields[i]; } }
    return null;
  }
  function edgesForOffer(offerId) {
    var out = [], i;
    for (i = 0; i < state.answer_maps.length; i++) {
      if (state.answer_maps[i] && state.answer_maps[i].offer_id === offerId) { out.push(state.answer_maps[i]); }
    }
    return out;
  }
  function findEdgeIndex(offerId, path) {
    var i;
    for (i = 0; i < state.answer_maps.length; i++) {
      if (state.answer_maps[i] && state.answer_maps[i].offer_id === offerId && state.answer_maps[i].offer_payload_field_path === path) { return i; }
    }
    return -1;
  }
  function questionByField(internalField) {
    var node = null;
    walkTree(state.content.components, 1, function (n) {
      if (node === null && n.internal_field === internalField) { node = n; }
    });
    return node;
  }
  // Mirror of sections.ts answerTypeNodeType/answerCoercible — the live cell
  // decode agrees with the server rebuild (seam-tested).
  function answerNodeType(answerType) {
    if (answerType === 'currency') { return 'number'; }
    if (answerType === 'number' || answerType === 'boolean' || answerType === 'enum' || answerType === 'array' || answerType === 'object' || answerType === 'string') { return answerType; }
    return 'string';
  }
  function coercibleTo(answerType, nodeType) {
    if (nodeType === 'string' || nodeType === 'enum') { return true; }
    return answerNodeType(answerType) === nodeType;
  }
  // Per-edge §12.11 completeness (complete / missing_required / type_mismatch /
  // orphaned) against the offer's ACTIVE-schema answer fields.
  function edgeMapState(edge, offer) {
    if (!offer || offer.has_active_schema !== true) { return 'orphaned'; }
    var field = answerFieldOf(offer, edge.offer_payload_field_path);
    if (!field) { return 'orphaned'; }
    if (edge.provider_expected_type !== field.type) { return 'type_mismatch'; }
    var hasMap = edge.output_value_map && typeof edge.output_value_map === 'object' && Object.keys(edge.output_value_map).length > 0;
    var hasTransform = edge.value_transform && edge.value_transform.length > 0;
    if (!hasMap && !hasTransform && !coercibleTo(edge.answer_type, field.type)) { return 'type_mismatch'; }
    if (edge.required_for_offer === true && trimStr(edge.internal_field) === '') { return 'missing_required'; }
    return 'complete';
  }
  // The §8.7 status-column decode over the LIVE model — mirrors
  // rebuildDerivedIndexes' per-offer derivation (not selected → selected/not
  // started → incomplete → complete → invalid).
  function offerLiveState(offer) {
    var selected = state.selected_offers.indexOf(offer.id) !== -1;
    var edges = edgesForOffer(offer.id);
    var fields = offer.answer_fields || [];
    var requiredTotal = 0, i;
    var requiredByPath = {};
    for (i = 0; i < fields.length; i++) {
      if (fields[i].required === true) { requiredByPath[fields[i].path] = true; requiredTotal += 1; }
    }
    var mappedByPath = {};
    var requiredMapped = 0;
    var hardError = false;
    var st;
    for (i = 0; i < edges.length; i++) {
      st = edgeMapState(edges[i], offer);
      if (st === 'type_mismatch' || st === 'orphaned') { hardError = true; }
      if (st === 'complete' && requiredByPath[edges[i].offer_payload_field_path] === true && mappedByPath[edges[i].offer_payload_field_path] !== true) {
        mappedByPath[edges[i].offer_payload_field_path] = true;
        requiredMapped += 1;
      }
    }
    var name;
    if (!selected && edges.length === 0) { name = 'not_selected'; }
    else if (edges.length === 0) { name = 'selected'; }
    else if (hardError) { name = 'invalid'; }
    else if (requiredMapped < requiredTotal) { name = 'incomplete'; }
    else { name = 'complete'; }
    return { state: name, selected: selected || edges.length > 0, required_total: requiredTotal, required_mapped: requiredMapped, mapped_edges: edges.length };
  }
  function upsertEdge(offer, field, internalField) {
    var node = questionByField(internalField);
    if (!node || !offer || !field) { return null; }
    var idx = findEdgeIndex(offer.id, field.path);
    var existing = idx === -1 ? null : state.answer_maps[idx];
    var meta = typeMeta(node.type);
    var edge = {
      question_id: node.question_id,
      question_key: node.question_key || node.question_id,
      internal_field: internalField,
      answer_type: node.answer_type || meta.produces || 'string',
      offer_id: offer.id,
      offer_payload_field_path: field.path,
      provider_expected_type: field.type,
      output_value_map: existing ? (existing.output_value_map || null) : null,
      value_transform: existing ? (existing.value_transform || null) : null,
      required_for_offer: field.required === true,
      default_value: existing ? (existing.default_value || null) : null,
      fallback_value: existing ? (existing.fallback_value || null) : null
    };
    if (idx === -1) { state.answer_maps.push(edge); } else { state.answer_maps[idx] = edge; }
    if (state.selected_offers.indexOf(offer.id) === -1) { state.selected_offers.push(offer.id); }
    markDirty();
    return edge;
  }
  function removeEdge(offerId, path) {
    var idx = findEdgeIndex(offerId, path);
    if (idx !== -1) { state.answer_maps.splice(idx, 1); markDirty(); }
  }
  function moveEdgePath(offer, fromPath, toField) {
    var idx = findEdgeIndex(offer.id, fromPath);
    if (idx === -1 || !toField) { return; }
    var internalField = state.answer_maps[idx].internal_field;
    removeEdge(offer.id, fromPath);
    upsertEdge(offer, toField, internalField);
  }
  function toggleOfferSelected(offerId, on) {
    var at = state.selected_offers.indexOf(offerId);
    if (on && at === -1) { state.selected_offers.push(offerId); markDirty(); }
    if (!on && at !== -1) {
      state.selected_offers.splice(at, 1);
      // Deselecting drops the offer's mapping edges (a mapped offer is
      // implicitly selected server-side — keeping edges would re-select it).
      var i;
      for (i = state.answer_maps.length - 1; i >= 0; i--) {
        if (state.answer_maps[i] && state.answer_maps[i].offer_id === offerId) { state.answer_maps.splice(i, 1); }
      }
      markDirty();
    }
  }
  // §8.7 "Create question for field": schema field type → the right component,
  // pre-bound to a new internal_field named from the schema path.
  function componentTypeForField(field) {
    var seg = String(field.path || '').split('.').pop() || '';
    if (field.type === 'boolean') { return 'TwoButtonYesNo'; }
    if (field.type === 'enum' || (field.valid_values && field.valid_values.length > 0)) { return 'DropdownQuestion'; }
    if (/dob|birth|date/i.test(seg)) { return 'DateQuestion'; }
    if (field.type === 'number') {
      return /currency|income|amount|price|premium|salary|loan/i.test(seg) ? 'CurrencyInputQuestion' : 'NumberInputQuestion';
    }
    return 'FreeTextQuestion';
  }
  function internalFieldFromPath(path) {
    var seg = String(path || '').split('.').pop() || '';
    var base = slugify(seg);
    if (base === '') { base = 'field'; }
    if (!fieldExists(base)) { return base; }
    return uniqueFieldName(base);
  }
  function createQuestionForField(offer, field) {
    var type = componentTypeForField(field);
    var node = addComponentAt(type, null, null);
    if (!node) { return null; }
    node.internal_field = internalFieldFromPath(field.path);
    if (field.valid_values && field.valid_values.length > 0) {
      var choices = [], i, v;
      for (i = 0; i < field.valid_values.length; i++) {
        v = String(field.valid_values[i]);
        choices.push({ label: v, value: v, analytics_id: v });
      }
      node.choices = choices;
    }
    if (field.required === true) { node.required = true; }
    upsertEdge(offer, field, node.internal_field);
    afterModelChange();
    return node;
  }
  // §8.7 bulk-map: name+type heuristic proposals (exact slug match preferred,
  // substring accepted, type-compatibility REQUIRED) — review before apply.
  function bulkProposals(offer) {
    var proposals = [];
    var fields = (offer && offer.answer_fields) || [];
    var sectionFields = internalFieldsOf();
    var i, j, f, seg, best, bestExact, cand, candSlug, compatible;
    for (i = 0; i < fields.length; i++) {
      f = fields[i];
      if (findEdgeIndex(offer.id, f.path) !== -1) { continue; }
      seg = slugify(String(f.path).split('.').pop() || '');
      if (seg === '') { continue; }
      best = null;
      bestExact = false;
      for (j = 0; j < sectionFields.length; j++) {
        cand = sectionFields[j];
        candSlug = slugify(cand);
        if (candSlug !== seg && candSlug.indexOf(seg) === -1 && seg.indexOf(candSlug) === -1) { continue; }
        compatible = coercibleTo(refFieldInfo(cand).type, f.type);
        if (!compatible) { continue; }
        if (candSlug === seg) { best = cand; bestExact = true; }
        else if (best === null) { best = cand; }
        if (bestExact) { break; }
      }
      if (best !== null) { proposals.push({ path: f.path, type: f.type, internal_field: best }); }
    }
    return proposals;
  }

  // --- §8.7/§8.2 panel DOM ------------------------------------------------------
  function offersNote(text) {
    var el = document.querySelector('[data-studio-offers-note]');
    if (el) { el.hidden = text === ''; el.textContent = text; }
  }
  function renderOffersStaleNote() {
    if (!offersData) { return; }
    var a = activitySel ? trimStr(activitySel.value) : '';
    var v = verticalSel ? trimStr(verticalSel.value) : '';
    if (a !== offersData.activity || v !== offersData.vertical) {
      offersNote("Activity/Vertical changed since the last save \\u2014 Save the Section to refresh the matching Offers (currently showing '" + offersData.activity + "' / '" + offersData.vertical + "').");
    } else { offersNote(''); }
  }
  // v3.1 §4.1 (adversarial review M1): the top-bar badge's contract is the
  // Appendix-A "Mapping k / n complete" FIELD-count — k/n are
  // required_mapped_total/required_fields_total SUMMED ACROSS every offer
  // that's "in play" (has a mapping edge OR is explicitly selected), exactly
  // mirroring the server's rebuildDerivedIndexes (src/leadgen/sections.ts):
  // an offer contributes its FULL schema required-field count once it has
  // ANY edge, not a per-offer "1 offer = 1 unit" count (the §8.1 offers-
  // panel's OWN "N/M Offers complete" wording is a DIFFERENT, offer-scoped
  // concept that belongs to that panel, never this shared top-bar element).
  // offerLiveState() already derives the identical per-offer required_total/
  // required_mapped (edge-mirrored, DEV-65c) — this only needed to SUM them
  // instead of counting offers, and stop writing the drawer's wording here.
  function updateMappingBadge() {
    var badge = document.querySelector('[data-studio-mapping-badge]');
    if (!badge || !offersData) { return; }
    var list = offersList();
    var total = 0, mapped = 0, i, live;
    for (i = 0; i < list.length; i++) {
      live = offerLiveState(list[i]);
      if (!live.selected) { continue; }
      total += live.required_total;
      mapped += live.required_mapped;
    }
    var complete = total > 0 && mapped === total;
    badge.textContent = 'Mapping ' + mapped + ' / ' + total + ' complete';
    badge.setAttribute('data-mapping-complete', complete ? 'true' : 'false');
    badge.setAttribute('data-mapping-total', String(total));
    badge.setAttribute('data-publishable', complete ? 'true' : 'false');
    // mirror renderStudioTopBar's own color logic (studio-tokens STUDIO_COLOR
    // success/successTintAlt/muted/issuesChipBg) so the badge's green/neutral
    // state stays live-accurate — className is left untouched (the SSR badge
    // never carried a badge-published/badge-archived class to toggle; the
    // color pair alone is the state indicator, same as the initial render).
    badge.style.color = complete ? '#0E7C3A' : '#5A6470';
    badge.style.background = complete ? '#E9F4EE' : '#F1F3F7';
    // R4a S3-9/E3-S6: the drawer Mapping-tab pill was SSR-once + hardcoded
    // green — guard it exactly like this same badge (same total/mapped/
    // complete just computed above) and keep it live on every refresh.
    // Golden fidelity: the TRUE/complete pair stays the drawer's OWN
    // byte-exact golden token (mappingBadgeBg #DBEEE2), distinct from the
    // top bar's own successTintAlt (#E9F4EE) — two different chips, each
    // matching ITS OWN spot in the golden mockup.
    var drawerPill = document.querySelector('[data-studio-drawer-mapping-pill]');
    if (drawerPill) {
      drawerPill.textContent = mapped + '/' + total;
      drawerPill.setAttribute('data-mapping-complete', complete ? 'true' : 'false');
      drawerPill.style.color = complete ? '#0E7C3A' : '#5A6470';
      drawerPill.style.background = complete ? '#DBEEE2' : '#F1F3F7';
    }
  }
  function offerStateLabel(name) {
    if (name === 'not_selected') { return 'not selected'; }
    if (name === 'selected') { return 'selected / not started'; }
    return name;
  }
  // The §12.11 per-state operator copy (ported from the old builder's mapping
  // grid — the exact vocabulary the sections-ui tests pinned).
  function mapStateNote(stateName, field, offer, edge) {
    if (stateName === 'complete') { return 'complete'; }
    if (stateName === 'missing_required') { return 'map required field'; }
    if (stateName === 'type_mismatch') {
      return 'answer type ' + (edge && edge.answer_type ? edge.answer_type + ' ' : '') + 'not coercible to ' + (field ? field.type : edge && edge.provider_expected_type);
    }
    if (stateName === 'orphaned') {
      return 'Offer field no longer exists in schema' + (offer && offer.payload_schema_public_id ? ' ' + offer.payload_schema_public_id : '');
    }
    return field && field.required === true ? 'required \\u2014 not mapped' : 'not mapped';
  }
  // §12.1/§12.5: the Field column shows the schema's field LABEL — the server
  // projects field_label (authored label > humanized leaf); the island
  // derives the SAME fallback for pre-§12.5 offers responses. The raw dotted
  // path retreats to the cell tooltip + the Advanced disclosure.
  function fieldDisplayLabel(f) {
    if (!f) { return ''; }
    if (typeof f.field_label === 'string' && trimStr(f.field_label) !== '') { return f.field_label; }
    if (typeof f.label === 'string' && trimStr(f.label) !== '') { return trimStr(f.label); }
    var leaf = String(f.path || '').split('.').pop() || String(f.path || '');
    var words = trimStr(leaf.replace(/[_-]+/g, ' '));
    if (words === '') { return String(f.path || ''); }
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  // §12.1 "Expected type in plain words" — operator vocabulary, never a bare
  // storage enum ("text", "number", "one of: …").
  function plainTypeWords(f) {
    if (!f) { return ''; }
    if (f.valid_values && f.valid_values.length > 0) { return 'one of: ' + f.valid_values.join(', '); }
    if (f.type === 'string') { return 'text'; }
    if (f.type === 'number') { return 'number'; }
    if (f.type === 'boolean') { return 'yes or no'; }
    if (f.type === 'enum') { return 'one of the allowed values'; }
    if (f.type === 'array') { return 'list'; }
    if (f.type === 'object') { return 'group of fields'; }
    return String(f.type || '');
  }
  // §12.1 Status column decode — operator words over the LIVE model:
  //   complete → complete · orphaned → unlinked · type_mismatch splits into a
  //   stored-vs-schema type drift ("type mismatch") vs a value-coercion gap a
  //   per-Offer value map would close ("needs values") · no edge or an edge
  //   with no linked component reads "not mapped".
  function fieldRowStatus(offer, field, edge) {
    if (!edge) {
      return { key: 'not-mapped', label: field && field.required === true ? 'required — not mapped' : 'not mapped' };
    }
    var st = edgeMapState(edge, offer);
    if (st === 'complete') { return { key: 'complete', label: 'complete' }; }
    if (st === 'orphaned') { return { key: 'unlinked', label: 'unlinked' }; }
    if (st === 'type_mismatch') {
      if (field && edge.provider_expected_type !== field.type) { return { key: 'type-mismatch', label: 'type mismatch' }; }
      return { key: 'needs-values', label: 'needs values' };
    }
    return { key: 'not-mapped', label: 'required — not mapped' };
  }
  // §12.1 Fix column — ONE action per row, each opening the exact editor
  // scoped to the row; a complete row needs none.
  function fixActionFor(offer, field, edge) {
    var st = fieldRowStatus(offer, field, edge);
    if (st.key === 'complete') { return null; }
    if (st.key === 'needs-values') { return { kind: 'values', label: 'Fill provider values…', offer_id: offer ? offer.id : 0 }; }
    if (st.key === 'type-mismatch') { return { kind: 'type', label: 'Fix type…', offer_id: offer ? offer.id : 0 }; }
    if (st.key === 'unlinked') { return { kind: 'relink', label: 'Re-link…', offer_id: offer ? offer.id : 0 }; }
    return { kind: 'map', label: 'Map…', offer_id: offer ? offer.id : 0 };
  }
  // §2.4/C6: the Mapped-component chip carries the component's POSITION among
  // this question unit's answer components ('#N', 1-based, tree order) — the
  // Section Builder never borrows the Quote Builder's step vocabulary.
  function answerComponentPosition(internalField) {
    var pos = 0, found = 0;
    walkTree(state.content.components, 1, function (n) {
      if (typeMeta(n.type).produces) {
        pos += 1;
        if (found === 0 && n.internal_field === internalField) { found = pos; }
      }
    });
    return found;
  }
  // §12.3 overlay decode for ONE answer component: how many live-selected
  // Offers its answer feeds + whether a REQUIRED Offer field is unsatisfied
  // (a required edge that is not complete, or a required schema field naming
  // this internal field with no edge at all).
  function overlayChipInfo(internalField) {
    var offers = offersList();
    var count = 0, requiredMissing = false;
    var i, j, e, live, fields, has;
    for (i = 0; i < offers.length; i++) {
      live = offerLiveState(offers[i]);
      if (live.state === 'not_selected') { continue; }
      has = false;
      for (j = 0; j < state.answer_maps.length; j++) {
        e = state.answer_maps[j];
        if (!e || e.offer_id !== offers[i].id || e.internal_field !== internalField) { continue; }
        has = true;
        if (e.required_for_offer === true && edgeMapState(e, offers[i]) !== 'complete') { requiredMissing = true; }
      }
      if (has) { count += 1; continue; }
      fields = offers[i].answer_fields || [];
      for (j = 0; j < fields.length; j++) {
        if (fields[j].required === true && fields[j].internal_field === internalField && findEdgeIndex(offers[i].id, fields[j].path) === -1) { requiredMissing = true; }
      }
    }
    return { count: count, required_missing: requiredMissing };
  }
  function offerDeepLink(offer) { return '/admin/leadgen/offers/' + encodeURIComponent(offer.public_id) + '/edit#payload'; }
  function btn(label, attr, offerId, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls || 'btn btn-sm btn-outline';
    b.setAttribute(attr, String(offerId));
    b.textContent = label;
    return b;
  }
  // One provider chip idiom for the §12.1 Offer cells.
  function providerTag(provider) {
    var tag = document.createElement('span');
    tag.className = 'studio-provider-tag';
    tag.setAttribute('data-offer-provider-chip', provider || '');
    tag.appendChild(document.createTextNode(provider || '\\u2014'));
    return tag;
  }
  // The §12.1 Fix cell: ONE action per row. "Fill provider values…" is the C1
  // deep link into that Offer's value-map surface (an anchor); the other
  // kinds are buttons the delegated handler routes to the exact editor.
  function buildFixCell(offer, field, edge) {
    var td = document.createElement('td');
    var action = fixActionFor(offer, field, edge);
    if (action === null) {
      td.appendChild(document.createTextNode('\\u2014'));
      return td;
    }
    var el;
    if (action.kind === 'values') {
      el = document.createElement('a');
      el.href = offerDeepLink(offer);
      el.target = '_blank';
      el.rel = 'noopener';
    } else {
      el = document.createElement('button');
      el.type = 'button';
    }
    el.className = 'btn btn-sm btn-outline';
    el.setAttribute('data-studio-fix', action.kind);
    el.setAttribute('data-fix-offer', String(offer.id));
    el.setAttribute('data-fix-path', field ? field.path : (edge ? edge.offer_payload_field_path : ''));
    el.setAttribute('data-fix-field', edge && edge.internal_field ? String(edge.internal_field) : '');
    el.appendChild(document.createTextNode(action.label));
    td.appendChild(el);
    return td;
  }
  // §12.1 field row — the nine contract columns for ONE (Offer × field) pair.
  // field is null for an ORPHANED edge (its path left the active schema).
  function buildFieldRow(offer, field, edge) {
    var tr = document.createElement('tr');
    var path = field ? field.path : (edge ? edge.offer_payload_field_path : '');
    tr.setAttribute('data-studio-field-row', offer.id + ':' + path);
    var td, span, node, pos, st;
    // Offer (+ provider chip)
    td = document.createElement('td');
    span = document.createElement('span');
    span.appendChild(document.createTextNode(offer.offer_name));
    td.appendChild(span);
    td.appendChild(providerTag(offer.provider));
    tr.appendChild(td);
    // Provider (plain)
    td = document.createElement('td');
    td.appendChild(document.createTextNode(offer.provider || '\\u2014'));
    tr.appendChild(td);
    // Placement (the default placement, starred)
    td = document.createElement('td');
    if (offer.default_placement_id) {
      td.title = 'Default placement';
      td.setAttribute('data-default-placement', offer.default_placement_id);
      td.appendChild(document.createTextNode('\\u2605 ' + offer.default_placement_id));
    } else {
      td.appendChild(document.createTextNode('\\u2014'));
    }
    tr.appendChild(td);
    // Field — the schema's LABEL; the raw path rides the tooltip (+ Advanced)
    td = document.createElement('td');
    span = document.createElement('span');
    span.setAttribute('data-field-label', '');
    span.setAttribute('data-field-path', path);
    span.title = path;
    span.appendChild(document.createTextNode(field ? fieldDisplayLabel(field) : fieldDisplayLabel({ path: path })));
    td.appendChild(span);
    tr.appendChild(td);
    // Expected type in plain words
    td = document.createElement('td');
    td.appendChild(document.createTextNode(field ? plainTypeWords(field) : '\\u2014'));
    tr.appendChild(td);
    // Required ✓ / —
    td = document.createElement('td');
    td.setAttribute('data-field-required', field && field.required === true ? 'true' : 'false');
    td.appendChild(document.createTextNode(field && field.required === true ? '\\u2713' : '\\u2014'));
    tr.appendChild(td);
    // Mapped component — display name + '#N' position chip (§2.4/C6: the
    // Section Builder speaks positions, never the Quote Builder's step word)
    td = document.createElement('td');
    node = edge && trimStr(edge.internal_field) !== '' ? questionByField(edge.internal_field) : null;
    if (node) {
      td.appendChild(document.createTextNode(typeLabel(node.type)));
      pos = answerComponentPosition(edge.internal_field);
      if (pos > 0) {
        span = document.createElement('span');
        span.className = 'studio-pos-chip';
        span.setAttribute('data-component-position', String(pos));
        span.title = 'Position in this question unit';
        span.appendChild(document.createTextNode('#' + pos));
        td.appendChild(span);
      }
    } else if (edge && trimStr(edge.internal_field) !== '') {
      td.appendChild(document.createTextNode('not on this question unit'));
    } else {
      td.appendChild(document.createTextNode('\\u2014 not mapped \\u2014'));
    }
    tr.appendChild(td);
    // Status — operator words, colored chip
    td = document.createElement('td');
    st = fieldRowStatus(offer, field, edge);
    span = document.createElement('span');
    span.className = 'studio-row-status';
    span.setAttribute('data-row-status', st.key);
    span.setAttribute('data-row-required', field && field.required === true ? 'true' : 'false');
    span.appendChild(document.createTextNode(st.label));
    td.appendChild(span);
    tr.appendChild(td);
    // Fix — ONE action per row
    tr.appendChild(buildFixCell(offer, field, edge));
    return tr;
  }
  // The per-Offer header row: selection + live summary + the offer-scoped
  // affordances (Map fields · Bulk-map · Payload · Schema) the §8.7 flows keep.
  function buildOfferHeadRow(offer) {
    var live = offerLiveState(offer);
    var tr = document.createElement('tr');
    tr.className = 'studio-offer-head';
    tr.setAttribute('data-studio-offer-row', offer.public_id);
    var td = document.createElement('td');
    var name = document.createElement('span');
    name.className = 'studio-offer-name';
    name.title = offer.public_id;
    name.appendChild(document.createTextNode(offer.offer_name));
    td.appendChild(name);
    td.appendChild(providerTag(offer.provider));
    tr.appendChild(td);
    td = document.createElement('td');
    td.colSpan = 8;
    var actions = document.createElement('div');
    actions.className = 'studio-pair';
    var selLabel = document.createElement('label');
    selLabel.className = 'lg-check';
    var sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.setAttribute('data-studio-offer-select', String(offer.id));
    sel.checked = live.selected;
    selLabel.appendChild(sel);
    selLabel.appendChild(document.createTextNode('selected'));
    actions.appendChild(selLabel);
    var stateEl = document.createElement('span');
    stateEl.className = 'studio-offer-state';
    stateEl.setAttribute('data-offer-mapping-state', live.state);
    stateEl.appendChild(document.createTextNode(offerStateLabel(live.state)));
    actions.appendChild(stateEl);
    var summary = document.createElement('span');
    summary.className = 'form-help';
    summary.setAttribute('data-offer-required-mapped', String(live.required_mapped));
    summary.appendChild(document.createTextNode(live.required_mapped + '/' + live.required_total + ' required fields mapped'));
    actions.appendChild(summary);
    var version = document.createElement('span');
    version.className = 'form-help';
    version.setAttribute('data-offer-schema-version', offer.payload_schema_version === null || offer.payload_schema_version === undefined ? '' : String(offer.payload_schema_version));
    version.appendChild(document.createTextNode(offer.has_active_schema ? 'payload v' + offer.payload_schema_version : 'no payload yet'));
    actions.appendChild(version);
    actions.appendChild(btn('Map fields', 'data-studio-offer-map', offer.id, 'btn btn-sm btn-secondary'));
    actions.appendChild(btn('Bulk-map', 'data-studio-offer-bulkmap', offer.id));
    actions.appendChild(btn('Payload', 'data-studio-offer-payload', offer.id));
    var schemaLink = document.createElement('a');
    schemaLink.className = 'btn btn-sm btn-outline';
    schemaLink.href = offerDeepLink(offer);
    schemaLink.target = '_blank';
    schemaLink.rel = 'noopener';
    schemaLink.setAttribute('data-studio-offer-schema-link', offer.public_id);
    schemaLink.textContent = 'Schema';
    actions.appendChild(schemaLink);
    td.appendChild(actions);
    tr.appendChild(td);
    return tr;
  }
  // §12.1/§12.5: the Advanced disclosure lists every raw dotted path the
  // normal table replaced with labels (one line per Offer × field).
  function renderMappingAdvancedPaths() {
    var listEl = document.querySelector('[data-studio-mapping-advanced-list]');
    if (!listEl) { return; }
    clearChildren(listEl);
    var list = offersList();
    var i, j, fields, li;
    for (i = 0; i < list.length; i++) {
      fields = list[i].answer_fields || [];
      for (j = 0; j < fields.length; j++) {
        li = document.createElement('li');
        li.setAttribute('data-advanced-path', fields[j].path);
        li.appendChild(document.createTextNode(list[i].offer_name + ' \\u00B7 ' + fieldDisplayLabel(fields[j]) + ' \\u2014 ' + fields[j].path));
        listEl.appendChild(li);
      }
    }
  }
  function renderOffersTable() {
    var body = document.querySelector('[data-studio-offers-body]');
    var wrap = document.querySelector('[data-studio-offers-table-wrap]');
    var empty = document.querySelector('[data-studio-offers-empty]');
    var emptyCopy = document.querySelector('[data-studio-offers-empty-copy]');
    if (!body || !offersData) { return; }
    var list = offersList();
    if (wrap) { wrap.hidden = list.length === 0; }
    if (empty) { empty.hidden = list.length > 0; }
    if (list.length === 0 && emptyCopy) {
      // E9 exact pattern — NEVER a silent empty list.
      emptyCopy.textContent = "No active Offers match Activity '" + offersData.activity + "' + Vertical '" + offersData.vertical + "'.";
      return;
    }
    clearChildren(body);
    var i, j, k, offer, fields, edge, edges, tr, td, note, seenPaths;
    for (i = 0; i < list.length; i++) {
      offer = list[i];
      body.appendChild(buildOfferHeadRow(offer));
      fields = offer.answer_fields || [];
      seenPaths = {};
      if (fields.length === 0) {
        tr = document.createElement('tr');
        tr.setAttribute('data-studio-field-row', offer.id + ':');
        td = document.createElement('td');
        td.colSpan = 9;
        note = document.createElement('span');
        note.className = 'form-help';
        note.appendChild(document.createTextNode(offer.has_active_schema ? 'The active payload schema has no answer-source fields to map.' : 'This Offer has no ACTIVE payload schema \\u2014 create one in the payload builder first.'));
        td.appendChild(note);
        tr.appendChild(td);
        body.appendChild(tr);
      }
      for (j = 0; j < fields.length; j++) {
        seenPaths[fields[j].path] = true;
        edge = null;
        k = findEdgeIndex(offer.id, fields[j].path);
        if (k !== -1) { edge = state.answer_maps[k]; }
        body.appendChild(buildFieldRow(offer, fields[j], edge));
      }
      // ORPHANED edges (paths no longer in the active schema) stay visible —
      // they decode to "unlinked" with the Re-link… fix.
      edges = edgesForOffer(offer.id);
      for (j = 0; j < edges.length; j++) {
        if (seenPaths[edges[j].offer_payload_field_path] === true) { continue; }
        body.appendChild(buildFieldRow(offer, null, edges[j]));
      }
    }
  }
  function questionOptions(select, field, current) {
    clearChildren(select);
    var none = document.createElement('option');
    none.value = '';
    none.textContent = '\\u2014 not mapped \\u2014';
    select.appendChild(none);
    var create = document.createElement('option');
    create.value = '__create__';
    create.textContent = '+ Create question for this field';
    select.appendChild(create);
    var fields = internalFieldsOf();
    var compatible = [], incompatible = [], i, o;
    for (i = 0; i < fields.length; i++) {
      if (coercibleTo(refFieldInfo(fields[i]).type, field.type)) { compatible.push(fields[i]); }
      else { incompatible.push(fields[i]); }
    }
    for (i = 0; i < compatible.length; i++) {
      o = document.createElement('option');
      o.value = compatible[i];
      o.textContent = compatible[i];
      select.appendChild(o);
    }
    for (i = 0; i < incompatible.length; i++) {
      o = document.createElement('option');
      o.value = incompatible[i];
      o.textContent = incompatible[i] + ' (type mismatch)';
      select.appendChild(o);
    }
    select.value = current;
  }
  // DEV-65(c)/§12.1: picker options speak the schema field LABEL + plain-word
  // type — never a raw dotted path (the path stays the option VALUE and the
  // row tooltip / Advanced list).
  function pathOptionLabel(f) {
    return fieldDisplayLabel(f) + ' \\u2014 ' + plainTypeWords(f) + (f.required === true ? ' (required)' : '');
  }
  function renderMapGrid() {
    var grid = document.querySelector('[data-studio-map-grid]');
    if (!grid) { return; }
    var offer = openMapOfferId === null ? null : offerById(openMapOfferId);
    grid.hidden = offer === null;
    clearChildren(grid);
    if (!offer) { return; }
    var head = document.createElement('div');
    head.className = 'studio-map-grid-head';
    var title = document.createElement('span');
    title.className = 'form-label';
    title.appendChild(document.createTextNode('Map fields \\u2014 ' + offer.offer_name + (offer.has_active_schema ? ' (schema v' + offer.payload_schema_version + ')' : '')));
    head.appendChild(title);
    var close = btn('Close', 'data-studio-map-close', offer.id);
    head.appendChild(close);
    grid.appendChild(head);
    var fields = offer.answer_fields || [];
    if (fields.length === 0) {
      var note = document.createElement('p');
      note.className = 'form-help';
      note.appendChild(document.createTextNode(offer.has_active_schema ? 'The active payload schema has no answer-source fields to map.' : 'This Offer has no ACTIVE payload schema \\u2014 create one in the payload builder first.'));
      grid.appendChild(note);
      return;
    }
    var i, f, row, pathSel, qSel, link, status, edge, edgeState, o, j;
    for (i = 0; i < fields.length; i++) {
      f = fields[i];
      edge = null;
      j = findEdgeIndex(offer.id, f.path);
      if (j !== -1) { edge = state.answer_maps[j]; }
      row = document.createElement('div');
      row.className = 'studio-map-row';
      row.setAttribute('data-map-row', f.path);
      pathSel = document.createElement('select');
      pathSel.className = 'form-input';
      pathSel.setAttribute('data-map-path', f.path);
      pathSel.setAttribute('aria-label', 'Offer payload field');
      // §12.1: options carry the field LABEL; the raw path rides the tooltip.
      pathSel.title = f.path;
      for (j = 0; j < fields.length; j++) {
        o = document.createElement('option');
        o.value = fields[j].path;
        o.textContent = pathOptionLabel(fields[j]);
        pathSel.appendChild(o);
      }
      pathSel.value = f.path;
      row.appendChild(pathSel);
      qSel = document.createElement('select');
      qSel.className = 'form-input';
      qSel.setAttribute('data-map-question', f.path);
      qSel.setAttribute('aria-label', 'Mapped question');
      questionOptions(qSel, f, edge ? edge.internal_field : '');
      row.appendChild(qSel);
      link = document.createElement('a');
      link.className = 'btn btn-sm btn-outline';
      link.href = offerDeepLink(offer);
      link.target = '_blank';
      link.rel = 'noopener';
      link.setAttribute('data-map-valuemap', f.path);
      link.textContent = 'Value map';
      row.appendChild(link);
      status = document.createElement('span');
      status.className = 'studio-map-status';
      edgeState = edge ? edgeMapState(edge, offer) : 'unmapped';
      status.setAttribute('data-map-state', edgeState);
      status.appendChild(document.createTextNode(mapStateNote(edgeState, f, offer, edge)));
      row.appendChild(status);
      grid.appendChild(row);
    }
  }
  function renderBulkReview(offer) {
    var wrap = document.querySelector('[data-studio-bulk-review]');
    if (!wrap) { return; }
    clearChildren(wrap);
    if (!offer) { wrap.hidden = true; return; }
    wrap.hidden = false;
    var proposals = bulkProposals(offer);
    var head = document.createElement('div');
    head.className = 'studio-map-grid-head';
    var title = document.createElement('span');
    title.className = 'form-label';
    title.appendChild(document.createTextNode('Bulk-map review \\u2014 ' + offer.offer_name));
    head.appendChild(title);
    head.appendChild(btn('Close', 'data-studio-bulk-close', offer.id));
    wrap.appendChild(head);
    if (proposals.length === 0) {
      var none = document.createElement('p');
      none.className = 'form-help';
      none.appendChild(document.createTextNode('No compatible unmapped fields found (name+type heuristic).'));
      wrap.appendChild(none);
      return;
    }
    var ul = document.createElement('ul');
    var i, li, cb, label;
    for (i = 0; i < proposals.length; i++) {
      li = document.createElement('li');
      label = document.createElement('label');
      label.className = 'lg-check';
      cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.setAttribute('data-bulk-path', proposals[i].path);
      cb.setAttribute('data-bulk-field', proposals[i].internal_field);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(proposals[i].path + ' (' + proposals[i].type + ') \\u2190 ' + proposals[i].internal_field));
      li.appendChild(label);
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    var apply = btn('Apply selected mappings', 'data-studio-bulk-apply', offer.id, 'btn btn-sm btn-primary');
    wrap.appendChild(apply);
  }
  // §8.6 Mapping tab: THIS component's internal_field per selected Offer.
  function renderInspectorMapping() {
    var wrap = document.querySelector('[data-studio-inspector-mapping]');
    if (!wrap) { return; }
    clearChildren(wrap);
    var node = selectedNode();
    var note = document.createElement('p');
    note.className = 'form-help';
    if (!node || trimStr(node.internal_field) === '') {
      note.appendChild(document.createTextNode('Give this component an internal field to map it to Offers.'));
      wrap.appendChild(note);
      return;
    }
    if (!offersData) {
      note.appendChild(document.createTextNode(state.public_id ? 'Loading Offers\\u2026' : 'Save the Section first to load matching Offers.'));
      wrap.appendChild(note);
      return;
    }
    var list = offersList();
    var shown = 0;
    var i, offer, live, row, name, sel, o, j, fields, current, edge, status, edgeState;
    for (i = 0; i < list.length; i++) {
      offer = list[i];
      live = offerLiveState(offer);
      if (live.state === 'not_selected') { continue; }
      shown += 1;
      row = document.createElement('div');
      row.className = 'studio-map-row';
      row.setAttribute('data-inspector-map-offer', offer.public_id);
      name = document.createElement('span');
      name.appendChild(document.createTextNode(offer.offer_name));
      row.appendChild(name);
      sel = document.createElement('select');
      sel.className = 'form-input';
      sel.setAttribute('data-inspector-quickmap', String(offer.id));
      o = document.createElement('option');
      o.value = '';
      o.textContent = '\\u2014 not mapped \\u2014';
      sel.appendChild(o);
      fields = offer.answer_fields || [];
      current = '';
      edge = null;
      for (j = 0; j < fields.length; j++) {
        o = document.createElement('option');
        o.value = fields[j].path;
        o.textContent = pathOptionLabel(fields[j]);
        sel.appendChild(o);
      }
      for (j = 0; j < state.answer_maps.length; j++) {
        if (state.answer_maps[j] && state.answer_maps[j].offer_id === offer.id && state.answer_maps[j].internal_field === node.internal_field) {
          current = state.answer_maps[j].offer_payload_field_path;
          edge = state.answer_maps[j];
          break;
        }
      }
      sel.value = current;
      row.appendChild(sel);
      status = document.createElement('span');
      status.className = 'studio-map-status';
      edgeState = edge ? edgeMapState(edge, offer) : 'unmapped';
      status.setAttribute('data-map-state', edgeState);
      status.appendChild(document.createTextNode(edge ? mapStateNote(edgeState, answerFieldOf(offer, current), offer, edge) : 'not mapped'));
      row.appendChild(status);
      wrap.appendChild(row);
    }
    if (shown === 0) {
      note.appendChild(document.createTextNode('No Offers selected yet \\u2014 select Offers in the mapping drawer first.'));
      wrap.appendChild(note);
    }
  }
  function renderMappingCount() {
    var el = document.querySelector('[data-studio-mapping-count]');
    if (el) { el.textContent = state.answer_maps.length + ' mapping edge' + (state.answer_maps.length === 1 ? '' : 's') + ' on this Section'; }
  }
  function renderOffersPanel() {
    if (!offersData) { return; }
    renderOffersTable();
    renderMappingAdvancedPaths();
    renderMapGrid();
    renderInspectorMapping();
    renderMappingCount();
    updateMappingBadge();
    renderOffersStaleNote();
    // R4a E3-S4: recompute from THIS (current) offersData every time it's
    // (re)loaded — previously renderZeroOffersWarning was only ever called
    // once, at the top of the save-click handler, using the STALE pre-save
    // capture. Single source now: whichever offersData is live drives it.
    renderZeroOffersWarning();
    // §12.3: the canvas overlay chips derive from the SAME live model — every
    // mapping edit repaints them (decoration is rebuild-per-pass idempotent).
    applyCanvasDecoration();
  }
  function loadOffers() {
    if (!state.public_id) {
      offersNote('Save the Section first \\u2014 the Available Offers panel derives from the SAVED Activity/Vertical pair.');
      return;
    }
    fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id) + '/offers', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body) {
        offersNote((res.body && res.body.error) || 'Failed to load the matching Offers');
        return;
      }
      offersData = res.body;
      offersNote('');
      renderOffersPanel();
    }).catch(function () { offersNote('Failed to load the matching Offers'); });
  }
  function showPayloadPreview(offer) {
    var wrap = document.querySelector('[data-studio-payload-preview-wrap]');
    var pre = document.querySelector('[data-studio-payload-preview]');
    var title = document.querySelector('[data-studio-payload-preview-title]');
    var noteEl = document.querySelector('[data-studio-payload-note]');
    if (!wrap || !pre || !state.public_id) { return; }
    wrap.hidden = false;
    if (title) { title.textContent = 'Generated payload preview \\u2014 ' + offer.offer_name; }
    if (noteEl) { noteEl.hidden = !dirty; }
    pre.textContent = 'Validating\\u2026';
    fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id) + '/validate-payload', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ answers: sampleAnswers(), offers: [offer.public_id] })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok || !res.body) {
        pre.textContent = 'validate-payload failed: ' + ((res.body && res.body.error) || 'error');
        return;
      }
      var rows = res.body.offers || [];
      var mine = null, i;
      for (i = 0; i < rows.length; i++) { if (rows[i].offer_id === offer.id) { mine = rows[i]; } }
      pre.textContent = JSON.stringify({
        offer: offer.offer_name,
        completeness: mine ? mine.completeness : null,
        missing: mine ? mine.missing : null,
        invalid: mine ? mine.invalid : null,
        payload: mine ? mine.payload : null,
        section_validation: res.body.section_validation || null
      }, null, 2);
    }).catch(function () { pre.textContent = 'validate-payload request failed'; });
  }

  // --- §12.1 Fix-action routing: each kind opens the EXACT editor scoped to
  // the row ------------------------------------------------------------------
  // "Map…" → the per-Offer Map-fields editor with the row's quick-map
  // question select focused (its '+ Create question for this field' option
  // keeps Direction B one step away for unmapped rows).
  function openFixMapGrid(offer, path) {
    openMapOfferId = offer.id;
    renderBulkReview(null);
    renderMapGrid();
    var sel = document.querySelector('[data-map-question="' + path + '"]');
    if (sel) {
      if (sel.scrollIntoView) { sel.scrollIntoView({ block: 'nearest' }); }
      if (sel.focus) { sel.focus(); }
    }
  }
  // "Fix type…" → the mapped component's internal-field surface (the
  // Advanced DISCLOSURE input, §8.8 — no longer a tab) — the place the
  // answer identity is authored.
  function openFixTypeSurface(internalField) {
    var node = questionByField(internalField);
    if (!node) { return false; }
    selectComponent(node.question_id);
    setAdvancedOpen(true);
    var inp = document.getElementById('lg-inspector-internal-field');
    if (inp && inp.focus) { inp.focus(); }
    return true;
  }
  // "Re-link…" → the component's quick-map on the inspector Offers tab
  // (picking a field there drops the stale edge for this Offer + component
  // and upserts the new one); a component-less edge falls back to the
  // Map-fields editor.
  function openFixRelink(offer, internalField, path) {
    var node = trimStr(internalField) === '' ? null : questionByField(internalField);
    if (!node) { openFixMapGrid(offer, path); return; }
    selectComponent(node.question_id);
    setInspectorTab('offers');
    var sel = document.querySelector('[data-inspector-quickmap="' + offer.id + '"]');
    if (sel) {
      if (sel.scrollIntoView) { sel.scrollIntoView({ block: 'nearest' }); }
      if (sel.focus) { sel.focus(); }
    }
  }

  // Delegated wiring for the whole mapping drawer panel.
  var mappingPanel = document.querySelector('[data-studio-drawer-panel="mapping"]');
  if (mappingPanel) {
    mappingPanel.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null;
      if (!t) { return; }
      // §12.1 Fix column (the 'values' kind is an anchor — the C1 deep link
      // navigates by itself and never reaches this leg's routing).
      var fixEl = t.closest('[data-studio-fix]');
      if (fixEl && fixEl.getAttribute('data-studio-fix') !== 'values') {
        var fixOffer = offerById(Number(fixEl.getAttribute('data-fix-offer')));
        if (!fixOffer) { return; }
        var fixKind = fixEl.getAttribute('data-studio-fix');
        var fixPath = fixEl.getAttribute('data-fix-path') || '';
        var fixField = fixEl.getAttribute('data-fix-field') || '';
        if (fixKind === 'map') { openFixMapGrid(fixOffer, fixPath); }
        else if (fixKind === 'type') { if (!openFixTypeSurface(fixField)) { openFixMapGrid(fixOffer, fixPath); } }
        else if (fixKind === 'relink') { openFixRelink(fixOffer, fixField, fixPath); }
        return;
      }
      var el = t.closest('[data-studio-offer-map]');
      if (el) { openMapOfferId = Number(el.getAttribute('data-studio-offer-map')); renderBulkReview(null); renderMapGrid(); return; }
      el = t.closest('[data-studio-map-close]');
      if (el) { openMapOfferId = null; renderMapGrid(); return; }
      el = t.closest('[data-studio-offer-bulkmap]');
      if (el) { renderBulkReview(offerById(Number(el.getAttribute('data-studio-offer-bulkmap')))); return; }
      el = t.closest('[data-studio-bulk-close]');
      if (el) { renderBulkReview(null); return; }
      el = t.closest('[data-studio-bulk-apply]');
      if (el) {
        var offer = offerById(Number(el.getAttribute('data-studio-bulk-apply')));
        if (!offer) { return; }
        var boxes = mappingPanel.querySelectorAll('[data-bulk-path]');
        var i, f;
        for (i = 0; i < boxes.length; i++) {
          if (!boxes[i].checked) { continue; }
          f = answerFieldOf(offer, boxes[i].getAttribute('data-bulk-path'));
          if (f) { upsertEdge(offer, f, boxes[i].getAttribute('data-bulk-field')); }
        }
        renderBulkReview(null);
        renderOffersPanel();
        return;
      }
      el = t.closest('[data-studio-offer-payload]');
      if (el) {
        var payOffer = offerById(Number(el.getAttribute('data-studio-offer-payload')));
        if (payOffer) { showPayloadPreview(payOffer); }
        return;
      }
      el = t.closest('[data-studio-payload-close]');
      if (el) {
        var pw = document.querySelector('[data-studio-payload-preview-wrap]');
        if (pw) { pw.hidden = true; }
        return;
      }
      el = t.closest('[data-studio-change-pair]');
      if (el && activitySel) { activitySel.focus(); return; }
    });
    mappingPanel.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) { return; }
      var offerIdAttr = t.getAttribute('data-studio-offer-select');
      if (offerIdAttr !== null) {
        toggleOfferSelected(Number(offerIdAttr), t.checked === true);
        renderOffersPanel();
        return;
      }
      var qPath = t.getAttribute('data-map-question');
      if (qPath !== null && openMapOfferId !== null) {
        var offer = offerById(openMapOfferId);
        var field = offer ? answerFieldOf(offer, qPath) : null;
        if (!offer || !field) { return; }
        if (t.value === '') { removeEdge(offer.id, field.path); }
        else if (t.value === '__create__') { createQuestionForField(offer, field); }
        else { upsertEdge(offer, field, t.value); }
        renderOffersPanel();
        return;
      }
      var fromPath = t.getAttribute('data-map-path');
      if (fromPath !== null && openMapOfferId !== null && t.value !== fromPath) {
        var moveOffer = offerById(openMapOfferId);
        if (moveOffer) { moveEdgePath(moveOffer, fromPath, answerFieldOf(moveOffer, t.value)); renderOffersPanel(); }
        return;
      }
    });
  }
  var inspectorMappingWrap = document.querySelector('[data-studio-inspector-mapping]');
  if (inspectorMappingWrap) {
    inspectorMappingWrap.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.getAttribute) { return; }
      var offerIdAttr = t.getAttribute('data-inspector-quickmap');
      if (offerIdAttr === null) { return; }
      var node = selectedNode();
      var offer = offerById(Number(offerIdAttr));
      if (!node || !offer || trimStr(node.internal_field) === '') { return; }
      var i;
      // drop THIS field's existing edge on the offer (one quick-map slot)
      for (i = state.answer_maps.length - 1; i >= 0; i--) {
        if (state.answer_maps[i] && state.answer_maps[i].offer_id === offer.id && state.answer_maps[i].internal_field === node.internal_field) {
          state.answer_maps.splice(i, 1);
          markDirty();
        }
      }
      if (t.value !== '') {
        var field = answerFieldOf(offer, t.value);
        if (field) { upsertEdge(offer, field, node.internal_field); }
      }
      renderOffersPanel();
    });
  }

  // --- §5.2/§8.4 binding wiring: strip ⇄ bound-node views of the ONE store -----
  // The strip inputs ARE the store (headline_text/subheadline_text). v3.1
  // §8.4: the Content tab's headline variant shows BOTH Headline AND
  // Subheadline inputs together (whichever bound node is selected) — so BOTH
  // data-bound-shared-input="section_headline"/"section_subheadline"
  // elements need their OWN wiring (a single generic bare-attribute
  // selector, pre-v3.1, only ever reached the FIRST one in DOM order).
  function collectBoundShared(bindValue) {
    var inputEl = document.querySelector('[data-bound-shared-input="' + bindValue + '"]');
    var strip = stripInputFor(bindValue);
    if (!inputEl || !strip) { return; }
    strip.value = inputEl.value;
    markDirty();
    scheduleCanvasRender();
  }
  function wireBoundSharedInput(bindValue) {
    var el = document.querySelector('[data-bound-shared-input="' + bindValue + '"]');
    if (!el) { return; }
    el.addEventListener('input', function () { collectBoundShared(bindValue); });
    el.addEventListener('change', function () { collectBoundShared(bindValue); });
  }
  wireBoundSharedInput('section_headline');
  wireBoundSharedInput('section_subheadline');
  // Typing in either strip input live-updates the canvas render AND mirrors
  // BOTH inspector fields (the Content tab shows both simultaneously
  // whenever any bound node is selected — §8.4 "one source, two places").
  function onStripInput() {
    // Gate the mirror sync on "a bound node IS the current selection" (the
    // pre-v3.1 single-field behavior) — otherwise typing in the strip while
    // some OTHER node is selected would silently write into the (hidden,
    // irrelevant) Content-tab headline/subheadline inputs, which is
    // observable as a second live-value field even though nothing shows it.
    var node = selectedNode();
    if (node && node.bind !== undefined) {
      var hIn = document.querySelector('[data-bound-shared-input="section_headline"]');
      var hStrip = stripInputFor('section_headline');
      if (hIn && hStrip && hIn.value !== hStrip.value) { hIn.value = hStrip.value; }
      var sIn = document.querySelector('[data-bound-shared-input="section_subheadline"]');
      var sStrip = stripInputFor('section_subheadline');
      if (sIn && sStrip && sIn.value !== sStrip.value) { sIn.value = sStrip.value; }
    }
    scheduleCanvasRender();
  }
  var stripHeadline = document.getElementById('lg-section-headline');
  var stripSubheadline = document.getElementById('lg-section-subheadline');
  if (stripHeadline) { stripHeadline.addEventListener('input', onStripInput); }
  if (stripSubheadline) { stripSubheadline.addEventListener('input', onStripInput); }
  // §5.2 hidden chip "[Show]": re-insert the bound node at the top.
  var boundShowBtns = document.querySelectorAll('[data-bound-show]');
  var bs;
  for (bs = 0; bs < boundShowBtns.length; bs++) {
    boundShowBtns[bs].addEventListener('click', function () {
      var node = insertBoundNodeAtTop(this.getAttribute('data-bound-show'));
      if (node) { selectComponent(node.question_id); }
    });
  }

  // --- §7.2 scope pills + choice-scope focus ------------------------------------
  var scopePills = document.querySelectorAll('[data-scope-pill]');
  var sp;
  for (sp = 0; sp < scopePills.length; sp++) {
    scopePills[sp].addEventListener('click', function () {
      var key = this.getAttribute('data-scope-pill');
      if (key === 'section') { selectComponent(null); return; }
      if (key === 'component') {
        if (selectedQuestionId) { setScope('component'); }
        return;
      }
      if (key === 'choice') {
        var node = selectedNode();
        if (!node || typeMeta(node.type).choice !== true) { return; }
        var first = (node.choices && node.choices.length) ? node.choices[0] : null;
        choiceScopeLabel = first && first.label !== undefined ? String(first.label) : '';
        setInspectorTab('content');
        setScope('choice');
        return;
      }
      if (key === 'frame') {
        // MINOR 9: the frame is Quote-Builder-owned — the pill DEEP-LINKS to
        // the using funnel's Quote Builder. One funnel → navigate; many → a
        // picker; zero → the pill is disabled (this handler never fires).
        var funnels = usageFunnelsOf();
        if (funnels.length === 0) { return; }
        if (funnels.length === 1) { window.location.href = funnelQuoteUrl(funnels[0]); return; }
        renderFramePillPicker(this, funnels);
        return;
      }
    });
  }
  // v3.1 R3b deliverable 1 (S2-2 reclassified): the Continue Content-tab
  // "Open Quote Builder →" link (was href="#0", dead) and the Style-tab's 3
  // "Edit in Quote Builder →" row buttons all share the ONE navigation function.
  var openQuoteBuilderBtn = document.querySelector('[data-open-quote-builder]');
  if (openQuoteBuilderBtn) {
    openQuoteBuilderBtn.addEventListener('click', function () { openQuoteBuilderNav(this); });
  }
  var changeInFrameBtns = document.querySelectorAll('[data-continue-change-in-frame]');
  var cif;
  for (cif = 0; cif < changeInFrameBtns.length; cif++) {
    changeInFrameBtns[cif].addEventListener('click', function () { openQuoteBuilderNav(this); });
  }
  // v3.1 R3b deliverable 8: the frame-scope read-only notice's OWN deep link
  // (Content + Style tab copies) — the SAME shared navigation.
  var frameScopeChangeBtns = document.querySelectorAll('[data-framescope-change-in-frame]');
  var fsc;
  for (fsc = 0; fsc < frameScopeChangeBtns.length; fsc++) {
    frameScopeChangeBtns[fsc].addEventListener('click', function () { openQuoteBuilderNav(this); });
  }
  // §7.5: focusing a choice row retargets the scope header to that choice
  // (synchronous — well inside the 100 ms probe budget).
  var choicesPanelWrap = document.querySelector('[data-inspector-choices]');
  if (choicesPanelWrap) {
    choicesPanelWrap.addEventListener('focusin', function (ev) {
      var row = ev.target && ev.target.closest ? ev.target.closest('[data-choice-row]') : null;
      if (!row) { return; }
      var labelInput = row.querySelector('[data-choice-field="label"]');
      choiceScopeLabel = labelInput ? labelInput.value : '';
      setScope('choice');
    });
  }

  // --- §5.4 frame hint toggle (presentation-only skeleton) ----------------------
  var frameHintBtn = document.querySelector('[data-studio-frame-hint]');
  if (frameHintBtn) {
    frameHintBtn.addEventListener('click', function () {
      var on = this.getAttribute('aria-pressed') !== 'true';
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.className = on ? 'btn btn-sm btn-outline active' : 'btn btn-sm btn-outline';
      var skels = document.querySelectorAll('[data-studio-frame-skeleton]');
      var i;
      for (i = 0; i < skels.length; i++) { skels[i].hidden = !on; }
    });
  }

  // --- §8.3 frame callout: dismiss persists per browser -------------------------
  var frameCallout = document.querySelector('[data-studio-frame-callout]');
  var CALLOUT_DISMISS_KEY = 'lg-studio-frame-callout-dismissed';
  if (frameCallout) {
    var calloutDismissed = false;
    try { calloutDismissed = window.localStorage.getItem(CALLOUT_DISMISS_KEY) === '1'; } catch (e4) { calloutDismissed = false; }
    if (calloutDismissed) { frameCallout.hidden = true; }
  }
  var calloutDismissBtn = document.querySelector('[data-studio-callout-dismiss]');
  if (calloutDismissBtn) {
    calloutDismissBtn.addEventListener('click', function () {
      if (frameCallout) { frameCallout.hidden = true; }
      try { window.localStorage.setItem(CALLOUT_DISMISS_KEY, '1'); } catch (e5) {}
    });
  }

  // --- §7.1/§2.4 "Used in N quotes" (the reuse line) -----------------------------
  function loadUsage() {
    if (!state.public_id) { return; }
    fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id) + '/usage', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      return r.json();
    }).then(function (j) {
      var rows = (j && j.usage && j.usage.variants) || [];
      var seen = {}, n = 0, i, q;
      for (i = 0; i < rows.length; i++) {
        q = rows[i] && rows[i].quote_public_id;
        if (q && seen[q] !== true) { seen[q] = true; n += 1; }
      }
      usageRows = rows;
      usageQuoteCount = n;
      renderScopeHeader();
      renderFramePreviewEmpty();
    }).catch(function () {});
  }

  // §10.6 "Preview theme" switcher (drawer): populates from the REAL
  // lg-funnel-themes KV list (GET /api/admin/leadgen/themes, Phase A/D's
  // JSON API — this admin studio only CONSUMES it; the Themes manager
  // SCREEN is Phase D's). A blank selection previews the default (Navy);
  // picking a theme re-renders via runPreview's additive theme_id param and
  // updates the Style tab's "from theme: X" note to the SAME picked name.
  function loadThemesList() {
    var sel = document.getElementById('lg-preview-theme');
    if (!sel) { return; }
    fetch('/api/admin/leadgen/themes', { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var items = (j && j.items) || [];
        clearChildren(sel);
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'Navy (default)';
        sel.appendChild(blank);
        var i, o;
        for (i = 0; i < items.length; i++) {
          o = document.createElement('option');
          o.value = items[i].id;
          o.textContent = items[i].name;
          sel.appendChild(o);
        }
      })
      .catch(function () {});
  }
  var previewThemeSelEl = document.getElementById('lg-preview-theme');
  if (previewThemeSelEl) {
    previewThemeSelEl.addEventListener('change', function () {
      var chosen = this.options[this.selectedIndex];
      previewThemeName = (chosen && trimStr(this.value) !== '') ? chosen.textContent : 'Navy';
      populateSizeControls(selectedNode());
      runPreview();
    });
  }

  // --- scalar controls (continue mode) --------------------------------------
  // R5 D2 (register S4-A2): the legacy #lg-address-validation checkbox
  // listener is REMOVED with its fieldset — state.address_validation_enabled
  // now round-trips load -> save purely through the state object (see the
  // SSR-side comment in renderStudioSettings), no DOM element involved.
  // §4.2 "On answer" segmented (golden :72-75) — replaces the old native
  // radio pair; click OR keyboard (Enter/Space, role="button" tabindex="0")
  // on either segment writes continue_mode through the single setContinueMode
  // writer shared with the canvas-toolbar auto-advance chip.
  var continueSegEls = document.querySelectorAll('[data-continue-mode]');
  var csi;
  function onContinueSegActivate() { setContinueMode(this.getAttribute('data-continue-mode')); }
  function onContinueSegKey(ev) {
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
      ev.preventDefault();
      setContinueMode(this.getAttribute('data-continue-mode'));
    }
  }
  for (csi = 0; csi < continueSegEls.length; csi++) {
    continueSegEls[csi].addEventListener('click', onContinueSegActivate);
    continueSegEls[csi].addEventListener('keydown', onContinueSegKey);
  }

  // v3.1 R3 MAJOR-2 (register E2-NEW-4): the §5.3 save-rewrite turns a retired
  // LogoStrip into the Site-logo image block, DROPPING its individual logos —
  // the one LOSSY migration (the text-role, helper_text->helper and
  // html->panelHtml rewrites are all lossless, so they stay silent). Every
  // save path (main Save + move-to-frame) confirms first via
  // confirmSaveMigrationLoss; a cancel returns before collectSection runs, so
  // the tree is never mutated and no PATCH fires.
  var LOSSY_LOGOSTRIP_SAVE_CONFIRM = 'This section contains a retired Logo strip element. Saving converts it to the Site-logo block and its individual logos are removed. Save anyway?';
  function contentHasRetiredLogoStrip(list) {
    var i;
    if (!list) { return false; }
    for (i = 0; i < list.length; i++) {
      if (!list[i] || typeof list[i] !== 'object') { continue; }
      if (list[i].type === 'LogoStrip') { return true; }
      if (list[i].children && list[i].children.length && contentHasRetiredLogoStrip(list[i].children)) { return true; }
    }
    return false;
  }
  function confirmSaveMigrationLoss() {
    if (state.content && state.content.components && contentHasRetiredLogoStrip(state.content.components)) {
      return window.confirm(LOSSY_LOGOSTRIP_SAVE_CONFIRM);
    }
    return true;
  }
  // --- Save (POST create / PATCH update) — the UNCHANGED old-island body shape ------------
  function collectSection() {
    // v3.1 audit-round G FIX 3b: §5.3-style save rewrite — migrate the legacy
    // props.helper_text to the canonical props.helper (contract §8.1/§11.3),
    // deleting the legacy key when writing the new one. With the load-fallback
    // in inspectorFieldValue this upgrades a v2.5 section to the canonical key
    // without losing copy (erratum 8). Runs at SAVE time on the whole tree
    // (nested container children included); preview keeps the render-time
    // fallback in presets.ts renderTextInput, so no double-write. Inlined as a
    // self-contained local recursion so the sliced collectSection carries its
    // own migration through the vm-probe save seam (no external walkTree dep).
    function migrateHelperKey(list) {
      var i, node;
      for (i = 0; i < list.length; i++) {
        node = list[i];
        if (!node || typeof node !== 'object') { continue; }
        if (node.props && node.props.helper_text !== undefined) {
          if (node.props.helper === undefined) { node.props.helper = node.props.helper_text; }
          delete node.props.helper_text;
        }
        if (node.children && node.children.length) { migrateHelperKey(node.children); }
      }
    }
    // v3.1 R3b deliverable 5b (E2-NEW-2): a node stored under the OLD (wrong)
    // "html" key before this phase's CONTENT_PROP_FIELDS fix must still save
    // cleanly — migrate html -> panelHtml at the SAME save seam
    // migrateHelperKey uses. Without this, previously-broken content stays
    // broken forever (REQUIRED_FIELDS.DisclosureLink.textProps=["panelHtml"]
    // 400s any save that lacks panelHtml).
    function migrateDisclosureLinkKey(list) {
      var i, node;
      for (i = 0; i < list.length; i++) {
        node = list[i];
        if (!node || typeof node !== 'object') { continue; }
        if (node.type === 'DisclosureLink' && node.props && node.props.html !== undefined) {
          if (node.props.panelHtml === undefined) { node.props.panelHtml = node.props.html; }
          delete node.props.html;
        }
        if (node.children && node.children.length) { migrateDisclosureLinkKey(node.children); }
      }
    }
    // v3.1 R3b deliverable 7 (E2-NEW-4/E3-NEW-5): §5.3's OWN retirement
    // migration (content-schema.ts rewriteRetiredNodeToPrimitive/
    // primitiveViewOfNode) was never invoked anywhere — a retired one-off
    // node (CategoryLabel/HelperText/LegalNote/ReassuranceBadge/
    // SecureFormBadge/LogoStrip) saved and stayed its OLD type forever,
    // contradicting §5.3's own "Save rewrites the node to the primitive
    // form." Re-implemented inline (ES5, no import — the island is an inline
    // script, same discipline as migrateHelperKey above) to mirror content-
    // schema.ts's function LOGIC-FOR-LOGIC (never re-derived/approximated):
    // LogoStrip -> ImageBlock(source:auto_logo) — LOSSY by the contract's OWN
    // documented simplification (only the first of >1 logos survives); the 5
    // text roles -> TextBlock(role:...) with text sourced from props.html for
    // legal / props.text for the rest, icon carried through when non-empty.
    // Mutates in place (matching migrateHelperKey's own mutation idiom) —
    // every OTHER field (question_id, internal_field, conditional,
    // design_overrides, children, ...) survives untouched, exactly like the
    // real function's spread-then-overwrite-type/props return shape.
    var RETIRED_TEXT_ROLE_BY_TYPE = { CategoryLabel: 'category_label', HelperText: 'helper', LegalNote: 'legal', ReassuranceBadge: 'reassurance', SecureFormBadge: 'secure_badge' };
    function rewriteRetiredNodeToPrimitiveInline(node) {
      if (node.type === 'LogoStrip') {
        node.type = 'ImageBlock';
        node.props = { source: 'auto_logo' };
        return;
      }
      var role = RETIRED_TEXT_ROLE_BY_TYPE[node.type];
      if (role === undefined) { return; }
      var oldProps = node.props || {};
      var text = role === 'legal' ? oldProps.html : oldProps.text;
      var icon = oldProps.icon;
      var newProps = { role: role };
      if (typeof text === 'string') { newProps.text = text; }
      if (typeof icon === 'string' && icon !== '') { newProps.icon = icon; }
      node.type = 'TextBlock';
      node.props = newProps;
    }
    function migrateRetiredNodes(list) {
      var i;
      for (i = 0; i < list.length; i++) {
        if (!list[i] || typeof list[i] !== 'object') { continue; }
        rewriteRetiredNodeToPrimitiveInline(list[i]);
        if (list[i].children && list[i].children.length) { migrateRetiredNodes(list[i].children); }
      }
    }
    if (state.content && state.content.components) {
      migrateHelperKey(state.content.components);
      migrateDisclosureLinkKey(state.content.components);
      migrateRetiredNodes(state.content.components);
    }
    var nameEl = document.getElementById('lg-section-name');
    var actEl = document.getElementById('lg-section-activity');
    var verEl = document.getElementById('lg-section-vertical');
    var headEl = document.getElementById('lg-section-headline');
    var subEl = document.getElementById('lg-section-subheadline');
    return {
      section_name: nameEl ? nameEl.value : '',
      activity: actEl ? actEl.value : '',
      vertical: verEl ? verEl.value : '',
      headline_text: headEl ? headEl.value : '',
      // an EMPTY subheadline is null (the validator's optional semantics) —
      // sending '' 400s the save (D2 browser-flow catch).
      subheadline_text: subEl && trimStr(subEl.value) !== '' ? subEl.value : null,
      continue_mode: state.continue_mode || 'button',
      address_validation_enabled: !!state.address_validation_enabled,
      content_json: JSON.stringify(state.content),
      answer_maps: state.answer_maps,
      selected_offers: state.selected_offers,
      // §9.5: the Section-level role overrides (null clears the column).
      design_overrides: state.design_overrides || null
    };
  }
  // §8.2 save-time warning: the (saved) pair matches zero active Offers —
  // non-blocking, but never silent.
  function renderZeroOffersWarning() {
    var warn = document.querySelector('[data-studio-zero-offers-warning]');
    if (!warn) { return; }
    if (offersData && offersList().length === 0) {
      warn.hidden = false;
      warn.textContent = "Warning: no active Offers match Activity '" + offersData.activity + "' + Vertical '" + offersData.vertical + "' \\u2014 the Section saves, but no Offer payload can be generated for it.";
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }
  }
  // --- FIX 5: save-response problems[] + 400 field-error inline routing -----------
  // A §3.6 problem path (components[i]…, children[j]…) resolves to its node so
  // a clicked row FOCUSES the offending component (the §6.7 inline idiom).
  function componentByProblemPath(path) {
    var segs = String(path).match(/components\\[(\\d+)\\]|children\\[(\\d+)\\]/g) || [];
    if (segs.length === 0 || String(path).indexOf('components[') !== 0) { return null; }
    var list = state.content.components;
    var node = null;
    var i, idx;
    for (i = 0; i < segs.length; i++) {
      idx = Number(segs[i].replace(/[^0-9]/g, ''));
      if (!list || !list[idx]) { return node; }
      node = list[idx];
      list = node.children;
    }
    return node;
  }
  function saveProblemFocusHandler(path) {
    return function () {
      var node = componentByProblemPath(path);
      if (node && node.question_id) { selectComponent(node.question_id); }
    };
  }
  function renderSaveProblems(problems) {
    var box = document.querySelector('[data-studio-save-problems]');
    if (!box) { return; }
    clearChildren(box);
    if (!problems || problems.length === 0) { box.hidden = true; return; }
    box.hidden = false;
    var head = document.createElement('p');
    head.setAttribute('data-save-problems-summary', '');
    head.appendChild(document.createTextNode('Saved \\u2014 with ' + problems.length + ' thing' + (problems.length === 1 ? '' : 's') + ' worth checking:'));
    box.appendChild(head);
    var list = document.createElement('ul');
    var i, li, btn;
    for (i = 0; i < problems.length; i++) {
      if (!problems[i]) { continue; }
      li = document.createElement('li');
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'studio-link-btn';
      btn.setAttribute('data-save-problem-path', String(problems[i].path || ''));
      btn.appendChild(document.createTextNode(String(problems[i].message || '')));
      btn.addEventListener('click', saveProblemFocusHandler(problems[i].path));
      li.appendChild(btn);
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  // R4a E3-NEW-3: a hard save failure (400) gets the message TEXT, not just
  // a bare red outline on the control — the SAME problems-list UI shape
  // (click-to-focus) existing sections already show after a non-blocking
  // save, but kept as its OWN self-contained function (a small duplicate of
  // renderSaveProblems's list-building, not a shared helper) so each stays
  // independently sliceable — this island's own vm-probe test convention
  // (test/leadgen-section-studio-ui.test.ts) slices named functions
  // standalone; a NEW cross-function dependency inside an EXISTING sliced
  // function throws ReferenceError in that isolated sandbox. The path here
  // is the raw fields-object key (e.g. "content.components[0]….x").
  function renderSaveFieldErrors(fieldProblems) {
    var box = document.querySelector('[data-studio-save-problems]');
    if (!box) { return; }
    clearChildren(box);
    if (!fieldProblems || fieldProblems.length === 0) { box.hidden = true; return; }
    box.hidden = false;
    var head = document.createElement('p');
    head.setAttribute('data-save-problems-summary', '');
    head.appendChild(document.createTextNode('Save failed \\u2014 ' + fieldProblems.length + ' field' + (fieldProblems.length === 1 ? '' : 's') + ' need attention:'));
    box.appendChild(head);
    var list = document.createElement('ul');
    var i, li, btn;
    for (i = 0; i < fieldProblems.length; i++) {
      if (!fieldProblems[i]) { continue; }
      li = document.createElement('li');
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'studio-link-btn';
      btn.setAttribute('data-save-problem-path', String(fieldProblems[i].path || ''));
      btn.appendChild(document.createTextNode(String(fieldProblems[i].message || '')));
      btn.addEventListener('click', saveProblemFocusHandler(fieldProblems[i].path));
      li.appendChild(btn);
      list.appendChild(li);
    }
    box.appendChild(list);
  }
  // R4a E3-NEW-1: a brand-new Section's minted URL, offered as an explicit
  // operator action (never an automatic/silent redirect) once problems[]
  // exist to read first.
  function appendContinueToSectionLink(publicId) {
    var box = document.querySelector('[data-studio-save-problems]');
    if (!box) { return; }
    var p = document.createElement('p');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-secondary';
    btn.setAttribute('data-continue-to-section', '');
    btn.appendChild(document.createTextNode('Continue to the Section \\u2192'));
    btn.addEventListener('click', function () {
      window.location.href = '/admin/leadgen/sections/' + encodeURIComponent(publicId) + '/edit';
    });
    p.appendChild(btn);
    box.appendChild(p);
  }
  // Scalar strip fields → their strip inputs (the save-path controls).
  var SAVE_FIELD_CONTROL_IDS = {
    section_name: 'lg-section-name',
    activity: 'lg-section-activity',
    vertical: 'lg-section-vertical',
    headline_text: 'lg-section-headline',
    subheadline_text: 'lg-section-subheadline'
  };
  function markSaveFieldControl(key) {
    var ctl = SAVE_FIELD_CONTROL_IDS[key] ? document.getElementById(SAVE_FIELD_CONTROL_IDS[key]) : null;
    if (!ctl) {
      ctl = document.querySelector('[data-inspector-field="' + key + '"]') ||
        document.querySelector('[data-inspector-vprop="' + key + '"]') ||
        document.querySelector('[data-container-prop="' + key + '"]');
    }
    if (ctl && ctl.className.indexOf('studio-control-invalid') === -1) { ctl.className = ctl.className + ' studio-control-invalid'; }
  }
  function routeSaveFieldErrors(fields) {
    if (!fields || typeof fields !== 'object') { return; }
    var k, focused = false, node, key;
    // R4a E3-NEW-3: collect the message TEXT alongside the outline — a
    // failed save gets readable field messages, not just a bare red border.
    var fieldProblems = [];
    for (k in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, k)) { continue; }
      // content.components[i]….<key> → focus the FIRST offending component,
      // then mark the matching control (the §6.7 inline idiom).
      if (k.indexOf('content.components[') === 0 && !focused) {
        node = componentByProblemPath(k.slice('content.'.length));
        if (node && node.question_id) { selectComponent(node.question_id); focused = true; }
      }
      key = k.replace(/^.*\\./, '');
      markSaveFieldControl(key);
      fieldProblems.push({ path: k, message: String(fields[k]) });
    }
    // typeof-guarded (not a bare reference) — matches afterModelChange's own
    // activeWidthDragCleanup precedent: this function is sliced STANDALONE
    // into an existing vitest vm-probe (test/leadgen-section-studio-ui.test.ts)
    // that predates renderSaveFieldErrors; a bare reference would throw
    // ReferenceError there for a concern (the message-text UI) entirely
    // outside what that probe tests.
    if (fieldProblems.length > 0 && typeof renderSaveFieldErrors !== 'undefined') { renderSaveFieldErrors(fieldProblems); }
  }
  var saveBtn = document.getElementById('lg-section-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var errEl = document.getElementById('lg-section-error');
      if (errEl) { errEl.hidden = true; }
      renderSaveProblems([]);
      renderZeroOffersWarning();
      // v3.1 R3 MAJOR-2 (register E2-NEW-4): the §5.3 save-rewrite drops a
      // retired LogoStrip's individual logos — confirm BEFORE anything mutates
      // (collectSection runs the migration in place). Cancel = content
      // untouched, no PATCH, button re-enabled.
      if (!confirmSaveMigrationLoss()) { return; }
      saveBtn.disabled = true;
      var isNew = !state.public_id;
      var url = isNew ? '/api/admin/leadgen/sections' : '/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id);
      fetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(collectSection())
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      }).then(function (res) {
        saveBtn.disabled = false;
        if (!res.ok) {
          if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Save failed'; }
          // FIX 5 / R4a E3-NEW-3: server-side FIELD errors route inline
          // where a control matches (400 body: { error, fields }), PLUS
          // their message text in the problems list.
          routeSaveFieldErrors(res.body && res.body.fields);
          return;
        }
        dirty = false;
        renderDirtyIndicator();
        // R4a E3-NEW-1: a first save that MINTS the public_id must be
        // idempotent from here on — a second Save click (before any
        // navigation) PATCHes, never double-POSTs.
        if (isNew && res.body && res.body.public_id) { state.public_id = res.body.public_id; }
        // §6.1.3: the history is per open editor and cleared on Save.
        historyReset();
        // R4a S3-10 (belt-and-braces): the offers panel/zero-offers warning
        // only reflect the SAVED activity/vertical when explicitly reloaded
        // — harmless-but-superfluous on the redirect branches below (a
        // dangling fetch the navigation aborts), essential on the
        // stay-on-page problems branch (no reload to do it implicitly).
        loadOffers();
        // FIX 5 / R4a E3-NEW-1: non-blocking problems[] surface as the
        // summary + click-to-focus rows — for EITHER a new or existing
        // Section (previously the isNew branch always redirected first,
        // silently discarding them). A NEW Section additionally gets an
        // explicit "Continue to the Section →" affordance (never an
        // automatic/silent redirect) since its URL still reads /new.
        var problems = (res.body && res.body.problems) ? res.body.problems : [];
        if (problems.length > 0) {
          renderSaveProblems(problems);
          if (isNew && res.body && res.body.public_id) { appendContinueToSectionLink(res.body.public_id); }
          return;
        }
        // R4a S3-10 EXPLICIT scope: "the reload redirect stays" — a clean
        // (0-problems) save keeps hard-navigating for BOTH new and existing
        // Sections, exactly as before E3-NEW-1. (Confirmed the hard way: an
        // earlier draft of this fix dropped the redirect for the !isNew
        // case reasoning it was now redundant — 4 pre-existing Playwright
        // specs explicitly wait on a page load event right after clicking
        // Save and broke immediately. Restored.)
        if (res.body && res.body.public_id) {
          window.location.href = '/admin/leadgen/sections/' + encodeURIComponent(res.body.public_id) + '/edit';
        } else {
          window.location.reload();
        }
      }).catch(function () {
        saveBtn.disabled = false;
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Save request failed'; }
      });
    });
  }
  var archiveBtn = document.getElementById('lg-section-archive');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', function () {
      if (!state.public_id) { return; }
      if (!window.confirm('Archive this Section? It can be reactivated later from the Sections list.')) { return; }
      var errEl = document.getElementById('lg-section-error');
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id), {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; }).catch(function () { return { ok: r.ok, body: null }; });
      }).then(function (res) {
        // R4a E3-NEW-9: check response.ok — a failure shows an error, no
        // silent redirect (previously this .then() had no ok-check at all).
        if (!res.ok) {
          if (errEl) { errEl.hidden = false; errEl.textContent = (res.body && res.body.error) || 'Archive failed'; }
          return;
        }
        dirty = false;
        renderDirtyIndicator();
        window.location.href = '/admin/leadgen/sections';
      }).catch(function () {
        if (errEl) { errEl.hidden = false; errEl.textContent = 'Archive request failed'; }
      });
    });
  }

  // --- §9.6 unsaved-changes guard ----------------------------------------------------------
  window.addEventListener('beforeunload', function (ev) {
    if (dirty) { ev.preventDefault(); ev.returnValue = ''; return ''; }
  });
  var watched = document.querySelectorAll('#lg-section-form input, #lg-section-form textarea, #lg-section-name, #lg-section-activity, #lg-section-vertical');
  var wi;
  for (wi = 0; wi < watched.length; wi++) {
    watched[wi].addEventListener('input', markDirty);
    watched[wi].addEventListener('change', markDirty);
  }

  // --- first paint ---------------------------------------------------------------------------
  renderDirtyIndicator();
  updatePendingUi();
  renderIssues();
  renderMapsBanner();
  renderBoundChips();
  updatePaletteBindItems();
  renderBindBanner();
  updateCanvasEmpty();
  // §6.2 default selection on open (contract: "the ZIP field" — generalized
  // to the first real answer node); selectComponent() already covers
  // decoration/breadcrumb/inspector-population/scope-header/toolbar in one call.
  selectComponent(findDefaultSelectionId());
  populateSectionOverrides();
  loadComponentPresets();
  loadFramePickerQuotes();
  loadActivities();
  loadVerticals();
  loadOffers();
  loadUsage();
  loadThemesList();
  // R5 fix-link integration: /admin/leadgen/sections/:id/edit#mapping (the
  // quote activation preflight's "Open Section Mapping" link) opens the
  // mapping drawer tab directly.
  if (window.location.hash === '#mapping') { setDrawerTab('mapping'); }
  runPreview();
}());
`;
