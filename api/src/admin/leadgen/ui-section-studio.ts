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
// §6.4 choice cluster, §5.4 Move-to-Quote-frame semantics (single-funnel
// confirm naming the funnel → real PUT /funnels/:id/frame + node removal
// persisted on the same action; used-by-many → funnel picker), §5.3 mode 5
// Preview-in-Quote-frame (frame picker + site selector → the landed
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
// The CANVAS deliberately injects the preview endpoint's HTML into a live DOM
// region (§8.1 "rendering via the REAL preset renderer — same srcdoc pipeline
// as preview, parity by construction"): the markup is OUR OWN server render
// (presets escape all author content) and the canvas needs real elements for
// selection hit-targets — the srcdoc-only rule stays for the preview iframe.
//
// Save path is UNCHANGED from the old island: POST /sections (new) or PATCH
// /sections/:id with {section_name, activity, vertical, headline_text,
// subheadline_text, continue_mode, address_validation_enabled, content_json,
// answer_maps} — answer_maps pass through untouched until the D2 §8.7 panel.

import { escapeHtml } from "../templates/layout";
import { COMPONENT_CATALOG, type ComponentType } from "../../public/leadgen/components/registry";
import {
  COLOR_TYPED_OVERRIDE_KEYS,
  CURATED_DESIGN_OVERRIDE_KEYS,
  LEADGEN_BG_PANEL_BACKGROUNDS,
  LEADGEN_BG_PANEL_GRADIENTS,
  LEADGEN_COLUMN_MOBILE_MODES,
  LEADGEN_COLUMN_RATIOS,
  LEADGEN_GAP_TOKENS,
  LEADGEN_GRID_SIZINGS,
  LEADGEN_MAX_CONTAINER_DEPTH,
  LEADGEN_PANEL_BACKGROUNDS,
  LEADGEN_PANEL_PADDINGS,
  LEADGEN_PANEL_RADII,
  LEADGEN_PANEL_SHADOWS,
  LEADGEN_PANEL_WIDTHS,
  LEADGEN_STACK_ALIGNS,
  LEADGEN_STACK_DIRECTIONS,
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

// ---------------------------------------------------------------------------
// §8.3 library grouping (by INTENT — not the catalog category) + copy
// ---------------------------------------------------------------------------

interface StudioGroup {
  key: string;
  label: string;
  types: readonly ComponentType[];
}

// v2.5 08 §8.3: the six intent-first Section palette groups. The palette
// carries ONLY `unit`/`both` scope types (§8.2 D5) — every `frame` scope type
// (ProgressBar, StepIndicator, HeaderLogo, BackButton, DisclosureLink,
// HeaderBar, FooterBar, BackgroundPanel) is REMOVED from the palette; the
// dismissible callout in renderStudioLibrary points to the Quote Builder for
// them. Lockstep-guarded by the studio test: groups = the catalog's
// unit ∪ both set exactly once; frame types placed ZERO times. Legacy
// frame-scope nodes already stored in content keep rendering on the canvas
// (with the §5.4 amber badge, island-side).
//
// C6 note (07 §7.4 / 02 §2.4): the §8.3 table names the last group "Slide
// navigation", but "slide" is FORBIDDEN vocabulary inside the Section Builder
// (C6 — Quote-Builder-only term); the C6 lint leg scans every emitted studio
// string. The group renders as "Navigation" here — deviation documented in
// the slice report.
export const STUDIO_LIBRARY_GROUPS: readonly StudioGroup[] = [
  { key: "question-copy", label: "Question copy", types: ["CategoryLabel", "QuestionHeadline", "Subheadline", "HelperText"] },
  {
    key: "choices",
    label: "Answer choices",
    types: [
      "ButtonAnswerGroup",
      "TwoButtonYesNo",
      "IconCardAnswerGrid",
      "ImageCardAnswerGrid",
      "MultiChoiceCardGroup",
      "DropdownQuestion",
      "SearchableDropdownQuestion",
      "OtherGroupSelector",
    ],
  },
  {
    key: "inputs",
    label: "Inputs",
    types: [
      "FreeTextQuestion",
      "NumberInputQuestion",
      "CurrencyInputQuestion",
      "RangeQuestion",
      "NumberRangeQuestion",
      "CurrencyRangeQuestion",
      "DateQuestion",
      "NameFieldsGroup",
      "EmailInputQuestion",
      "PhoneInputQuestion",
      "ZIPInputQuestion",
      "AddressAutocompleteQuestion",
    ],
  },
  {
    key: "layout",
    label: "Inside-card layout",
    types: ["CardPanel", "Stack", "GridContainer", "Columns", "Spacer"],
  },
  {
    key: "trust",
    label: "Trust & help — inside this question unit",
    types: ["ReassuranceBadge", "SecureFormBadge", "TrustBar", "LogoStrip", "LegalNote", "ValidationError", "SuccessState"],
  },
  {
    key: "navigation",
    label: "Navigation",
    types: ["ContinueButton", "AutoAdvanceButton"],
  },
];

// §8.3 C7 scope note under the Trust & help group (verbatim).
export const STUDIO_TRUST_SCOPE_NOTE =
  "These travel with this Section, inside the question unit. Funnel-wide trust strips, logo rows and the legal footer are configured in the Quote Builder.";

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
  PhoneInputQuestion: { label: "Phone", description: "Phone input with format validation." },
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
  ValidationError: { label: "Error message line", description: "Inline error line for a field." },
  LegalNote: { label: "Legal note", description: "Small-print legal copy block." },
  Stack: { label: "Stack", description: "Vertical/horizontal token-gap grouping." },
  GridContainer: { label: "Answer grid", description: "Per-breakpoint column grid container." },
  Columns: { label: "Two columns", description: "Two-column ratio preset with mobile stacking." },
  CardPanel: { label: "Question card", description: "The centered question card container." },
  BackgroundPanel: { label: "Background panel", description: "Full-background panel with token fill." },
  Spacer: { label: "Spacer", description: "Token-sized vertical gap." },
  HeaderBar: { label: "Header bar", description: "Header slot: logo, back, secure, call CTA." },
  FooterBar: { label: "Footer bar", description: "Footer slot: legal, trust messages, links." },
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
};

// ---------------------------------------------------------------------------
// Per-type inspector projections (Content tab copy fields + Validation tab
// numeric/text rules) — derived by reading what each preset consumes.
// ---------------------------------------------------------------------------

// Content-tab prop keys per type (display copy the §8.6 Content tab edits).
// `helper_text` is the generic per-node helper line the old inspector kept.
const CONTENT_PROP_FIELDS: Record<ComponentType, readonly string[]> = {
  ProgressBar: ["label"],
  HeaderLogo: ["logoMediaId"],
  BackButton: ["label"],
  DisclosureLink: ["html"],
  StepIndicator: [],
  CategoryLabel: ["text"],
  QuestionHeadline: ["text"],
  Subheadline: ["text"],
  HelperText: ["text"],
  RangeQuestion: ["minLabel", "maxLabel", "helper_text"],
  CurrencyRangeQuestion: ["minLabel", "maxLabel", "currency", "helper_text"],
  NumberRangeQuestion: ["minLabel", "maxLabel", "helper_text"],
  ButtonAnswerGroup: ["helper_text"],
  TwoButtonYesNo: ["yesLabel", "noLabel", "helper_text"],
  IconCardAnswerGrid: ["helper_text"],
  ImageCardAnswerGrid: ["helper_text"],
  MultiChoiceCardGroup: ["helper_text"],
  DropdownQuestion: ["placeholder", "helper_text"],
  SearchableDropdownQuestion: ["placeholder", "helper_text"],
  OtherGroupSelector: ["helper_text"],
  FreeTextQuestion: ["placeholder", "helper_text"],
  NumberInputQuestion: ["placeholder", "helper_text"],
  CurrencyInputQuestion: ["placeholder", "currency", "helper_text"],
  EmailInputQuestion: ["placeholder", "helper_text"],
  PhoneInputQuestion: ["placeholder", "helper_text"],
  NameFieldsGroup: ["helper_text"],
  DateQuestion: ["placeholder", "helper_text"],
  ZIPInputQuestion: ["placeholder", "helper_text"],
  AddressAutocompleteQuestion: ["placeholder", "helper_text"],
  ContinueButton: ["label", "loadingLabel"],
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
};

// The union of content controls the Content tab server-renders once; the
// island shows only the selected type's keys (CONTENT_PROP_FIELDS projection).
const CONTENT_CONTROLS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "text", label: "Text" },
  { key: "label", label: "Label" },
  { key: "yesLabel", label: "Yes label" },
  { key: "noLabel", label: "No label" },
  { key: "placeholder", label: "Placeholder" },
  { key: "helper_text", label: "Helper text" },
  { key: "heading", label: "Heading" },
  { key: "message", label: "Message" },
  { key: "icon", label: "Icon (emoji / glyph)" },
  { key: "html", label: "Rich text / legal copy" },
  { key: "minLabel", label: "Min label" },
  { key: "maxLabel", label: "Max label" },
  { key: "currency", label: "Currency symbol" },
  { key: "loadingLabel", label: "Loading label" },
  { key: "logoMediaId", label: "Logo media id" },
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
}

function issueChip(count: number): string {
  const label = count === 1 ? "1 issue" : `${count} issues`;
  return `<button type="button" class="studio-chip studio-chip-validation" data-studio-validation-chip data-issue-count="${count}" aria-live="polite">${escapeHtml(count === 0 ? "No issues" : label)}</button>`;
}

// The §8.1 top bar. §8.2 (Slice D2): Activity/Vertical are DROPDOWNS — the
// island feeds Activity from GET /activities and Vertical from
// GET /verticals?activity=<sel> (changing Activity resets Vertical); no free
// text by default — the "+ New activity…"/"+ New vertical…" affordances
// require the explicit "No Offers exist for '<x>' yet" confirm. The SSR
// select carries only the saved value so a legacy value never breaks; element
// ids stay lg-section-activity / lg-section-vertical so collectSection + the
// dirty watcher carry over unchanged. The mapping badge is island-rewritten to
// the §8.1 "Mapping k/n Offers complete" text once the offers panel loads.
export function renderStudioTopBar(
  view: StudioSectionView,
  summary: StudioMappingSummary,
  statusPillHtml: string,
  initialIssueCount: number,
): string {
  const isNew = view.public_id === null;
  const mappingBadge = summary.publishable
    ? `<span class="studio-chip studio-chip-mapping badge badge-published" data-studio-mapping-badge data-publishable="true">Mapping ready</span>`
    : `<span class="studio-chip studio-chip-mapping badge badge-archived" data-studio-mapping-badge data-publishable="false">${summary.required_missing_total} required mapping${summary.required_missing_total === 1 ? "" : "s"} missing</span>`;
  const currentOption = (value: string): string =>
    value === "" ? `<option value="" selected>— pick —</option>` : `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>`;
  return `<div class="studio-topbar" data-studio-topbar>
  <a href="/admin/leadgen/sections" class="btn btn-outline studio-back">&#8592; Sections</a>
  <div class="form-group studio-name">
    <label class="form-label" for="lg-section-name">Section name *</label>
    <input id="lg-section-name" name="section_name" class="form-input" required aria-required="true" value="${escapeHtml(view.section_name)}" />
  </div>
  ${isNew ? "" : statusPillHtml}
  <div class="form-group studio-activity">
    <label class="form-label" for="lg-section-activity">Activity *</label>
    <div class="studio-pair">
      <select id="lg-section-activity" name="activity" class="form-input" data-studio-activity required aria-required="true">${currentOption(view.activity)}</select>
      <button type="button" class="btn btn-sm btn-outline" data-studio-new-activity title="Create a new activity">+ New activity&#8230;</button>
    </div>
  </div>
  <div class="form-group studio-vertical">
    <label class="form-label" for="lg-section-vertical">Vertical *</label>
    <div class="studio-pair">
      <select id="lg-section-vertical" name="vertical" class="form-input" data-studio-vertical required aria-required="true">${currentOption(view.vertical)}</select>
      <button type="button" class="btn btn-sm btn-outline" data-studio-new-vertical title="Create a new vertical">+ New vertical&#8230;</button>
    </div>
  </div>
  <span class="lg-editor-spacer"></span>
  ${mappingBadge}
  ${issueChip(initialIssueCount)}
  <button type="button" id="lg-section-save" class="btn btn-primary">Save</button>
  <button type="button" id="lg-section-archive" class="btn btn-danger"${isNew || view.status === "archived" ? " disabled" : ""}>Archive</button>
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
export function renderStudioSettings(view: StudioSectionView, mapsKeyConfigured: boolean): string {
  const mapsKeyNote = mapsKeyConfigured
    ? `<span class="lg-maps-note" data-maps-key="configured">Maps key configured (operator-owned browser key) — autofill available.</span>`
    : `<span class="lg-maps-note" data-maps-key="absent">Maps key not configured — autofill disabled (§30.2 no-op).</span>`;
  const hiddenChip = (bind: "section_headline" | "section_subheadline"): string =>
    `<span class="studio-hidden-chip" data-bound-chip="${bind}" hidden>Hidden in this question unit &#183; <button type="button" class="studio-hidden-show" data-bound-show="${bind}">Show</button></span>`;
  return `<form id="lg-section-form" class="studio-settings" data-studio-settings data-studio-question-strip novalidate>
  <div class="form-group">
    <label class="form-label" for="lg-section-headline">Question headline *</label>
    <input id="lg-section-headline" name="headline_text" class="form-input" required aria-required="true" value="${escapeHtml(view.headline_text)}" />
    ${hiddenChip("section_headline")}
  </div>
  <div class="form-group">
    <label class="form-label" for="lg-section-subheadline">Subheadline</label>
    <input id="lg-section-subheadline" name="subheadline_text" class="form-input" value="${escapeHtml(view.subheadline_text ?? "")}" />
    ${hiddenChip("section_subheadline")}
  </div>
  <fieldset class="form-group">
    <legend class="form-label">Continue behavior</legend>
    <label class="lg-check"><input type="radio" name="continue_mode" value="button"${view.continue_mode === "button" ? " checked" : ""} /> Visitor taps Continue (validates first)</label>
    <label class="lg-check"><input type="radio" name="continue_mode" value="auto_advance"${view.continue_mode === "auto_advance" ? " checked" : ""} /> Advance automatically on answer</label>
    <span class="form-help" data-continue-frame-note>The Continue button&#8217;s default style and position come from the Quote&#8217;s frame.</span>
  </fieldset>
  <div class="form-group">
    <label class="lg-check"><input type="checkbox" id="lg-address-validation" name="address_validation_enabled"${view.address_validation_enabled ? " checked" : ""} /> Google-Maps address / ZIP validation (§12.8)</label>
    <span class="lg-maps-note" data-maps-legacy-note>Legacy GLOBAL toggle (column kept for compat) — per-field Maps config on an Address/ZIP component (Inspector &#8594; Maps tab) WINS over it when present (§8.8).</span>
    <span class="lg-maps-note">The Maps key is a wrangler secret (GOOGLE_MAPS_BROWSER_KEY) — never embedded in cached HTML. Absent key &#8658; the validation leg no-ops.</span>
    ${mapsKeyNote}
  </div>
</form>
<div class="studio-bind-banner" data-bind-banner hidden role="status" aria-live="polite"></div>`;
}

// ---------------------------------------------------------------------------
// §8.3 component library (left rail)
// ---------------------------------------------------------------------------

// §5.2: the two bindable palette items insert BOUND nodes; while a bound node
// for their bind value exists they are disabled with the exact tooltip. The
// island keeps this live (updatePaletteBindItems); SSR stamps the initial
// state so the served page is already correct.
const PALETTE_BIND_OF_TYPE: Partial<Record<ComponentType, "section_headline" | "section_subheadline">> = {
  QuestionHeadline: "section_headline",
  Subheadline: "section_subheadline",
};

function paletteBindTooltip(bind: "section_headline" | "section_subheadline"): string {
  return bind === "section_subheadline"
    ? "This Section already shows its subheadline"
    : "This Section already shows its headline";
}

function collectExistingBinds(content: LeadgenSectionContent): ReadonlySet<string> {
  const binds = new Set<string>();
  const walk = (nodes: unknown, depth: number): void => {
    if (!Array.isArray(nodes) || depth > LEADGEN_MAX_CONTAINER_DEPTH + 1) return;
    for (const raw of nodes) {
      if (typeof raw !== "object" || raw === null) continue;
      const node = raw as { bind?: unknown; children?: unknown };
      if (typeof node.bind === "string") binds.add(node.bind);
      walk(node.children, depth + 1);
    }
  };
  walk(content.components, 1);
  return binds;
}

// MINOR 11 (07 §7.4 operator words): the library answer-type chip speaks
// PLAIN WORDS derived from the catalog `produces` — never the raw identifier
// (enum/boolean/array/object are code vocabulary). One label per produces
// value; an unknown future value falls back to a neutral phrase rather than
// leaking the identifier.
const PRODUCES_CHIP_LABELS: Record<string, string> = {
  enum: "stores one choice",
  boolean: "stores one choice",
  array: "stores several choices",
  number: "stores a number",
  currency: "stores a number",
  string: "stores text/number/date",
  object: "stores grouped fields",
};

function producesChipLabel(produces: string): string {
  return PRODUCES_CHIP_LABELS[produces] ?? "stores an answer";
}

function renderLibraryItem(type: ComponentType, design: FunnelDesign, existingBinds: ReadonlySet<string>): string {
  const meta = STUDIO_TYPE_META[type];
  const produces = COMPONENT_CATALOG[type].produces;
  // The thumbnail IS the component's own preset render with sample props,
  // scaled down by CSS transform (equivalent-fidelity choice documented in
  // the slice report; inline-SVG wrapping is not required for parity).
  //
  // The item wrapper MUST NOT be a <button>: preset thumbnails legitimately
  // contain interactive markup (answer <button>s, <input>s), and nested
  // interactive content inside a button is INVALID HTML — the browser parser
  // closes the outer button early and shatters the whole studio layout out of
  // the admin shell (found by the first D2 Playwright exposure). A
  // role="button" div keeps click-to-add + drag + a11y; the thumb itself is
  // pointer-events:none so the inner preset controls are inert.
  const thumbHtml = renderComponent(STUDIO_SAMPLE_NODES[type], design);
  const answerType =
    produces === null ? "" : `<span class="studio-item-type">${escapeHtml(producesChipLabel(String(produces)))}</span>`;
  const mapsBadge = produces === null ? "" : `<span class="studio-item-maps" data-maps-badge>maps to Offer fields</span>`;
  const bind = PALETTE_BIND_OF_TYPE[type];
  const bindDisabled = bind !== undefined && existingBinds.has(bind);
  const bindAttrs =
    bind === undefined
      ? ""
      : ` data-bind-item="${bind}" data-bind-disabled="${bindDisabled ? "true" : "false"}" aria-disabled="${bindDisabled ? "true" : "false"}"${bindDisabled ? ` title="${escapeHtml(paletteBindTooltip(bind))}"` : ""}`;
  return `<div class="studio-library-item" role="button" tabindex="0" draggable="true" data-add-component="${escapeHtml(type)}"${bindAttrs} data-search-text="${escapeHtml(`${meta.label} ${meta.description}`.toLowerCase())}" aria-label="Add ${escapeHtml(meta.label)}">
  <span class="studio-thumb" aria-hidden="true"><span class="studio-thumb-scale" data-funnel-design="${escapeHtml(design.id)}">${thumbHtml}</span></span>
  <span class="studio-item-body">
    <span class="studio-item-name">${escapeHtml(meta.label)}</span>
    <span class="studio-item-desc">${escapeHtml(meta.description)}</span>
    <span class="studio-item-meta">${answerType}${mapsBadge}</span>
  </span>
</div>`;
}

// §8.3: the dismissible callout that replaced the old Layout group's frame
// items — page chrome lives in the Quote Builder. Dismissal persists in
// localStorage (island); [Open] deep-links the Quotes tab.
function renderFrameCallout(): string {
  return `<div class="studio-frame-callout" data-studio-frame-callout role="note">
  <span class="studio-frame-callout-copy">Looking for the page header, footer, progress bar or background? Those live in the <strong>Quote Builder</strong> &#8594; <a href="/admin/leadgen/quotes" class="studio-frame-callout-open" data-studio-callout-open>Open</a></span>
  <button type="button" class="studio-frame-callout-dismiss" data-studio-callout-dismiss aria-label="Dismiss">&#215;</button>
</div>`;
}

export function renderStudioLibrary(design: FunnelDesign, content: LeadgenSectionContent): string {
  const existingBinds = collectExistingBinds(content);
  const groups = STUDIO_LIBRARY_GROUPS.map((group) => {
    const items = group.types.map((t) => renderLibraryItem(t, design, existingBinds)).join("");
    // C7 (§8.3): the Trust & help group carries the scope note verbatim.
    const scopeNote =
      group.key === "trust"
        ? `<p class="studio-scope-note" data-trust-scope-note>${escapeHtml(STUDIO_TRUST_SCOPE_NOTE)}</p>`
        : "";
    // The callout replaces the old Layout group's frame items — rendered at
    // the old group's position (after the inside-unit layout group).
    const callout = group.key === "layout" ? renderFrameCallout() : "";
    return `<div class="studio-library-group" data-library-group="${escapeHtml(group.key)}">
  <h4 class="studio-library-heading">${escapeHtml(group.label)}</h4>
  ${scopeNote}<div class="studio-library-items">${items}</div>
</div>${callout}`;
  }).join("");
  return `<div class="studio-library" data-studio-library aria-label="Component library">
  <input type="search" class="form-input studio-library-search" data-studio-library-search placeholder="Search components…" aria-label="Search components" />
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

// §5.4 "Frame hint": a dimmed, NON-interactive, GENERIC frame skeleton around
// the unit for spatial context — presentation-only, never editable here (the
// real frame is Quote-Builder-owned). Toggled by [data-studio-frame-hint].
function renderFrameHintSkeleton(edge: "top" | "bottom"): string {
  const inner =
    edge === "top"
      ? `<div class="studio-skel-header"><span class="studio-skel-logo"></span><span class="studio-skel-bar"></span></div><div class="studio-skel-progress"></div>`
      : `<div class="studio-skel-footer"><span class="studio-skel-bar"></span><span class="studio-skel-bar studio-skel-bar-short"></span></div>`;
  return `<div class="studio-frame-skeleton" data-studio-frame-skeleton="${edge}" hidden aria-hidden="true">${inner}</div>`;
}

// §6.1.2 / §7.1: ONE scope-pill implementation for BOTH hosts (toolbar +
// inspector scope header). The island updates every [data-scope-pill]
// instance document-wide, so the two hosts can never disagree.
export function renderScopePillsMarkup(): string {
  // MINOR 9: the "Funnel frame" pill DEEP-LINKS to the using funnel's Quote
  // Builder (the island enables it once usage loads; many funnels → a picker;
  // zero usage keeps it disabled). SSR ships it disabled — usage is not known
  // at render time.
  return `<div class="studio-scope-pills" role="group" aria-label="Editing scope">
    <button type="button" class="studio-scope-pill" data-scope-pill="frame" disabled title="Page-frame elements are edited in the Quote Builder">Funnel frame</button>
    <button type="button" class="studio-scope-pill active" data-scope-pill="section" aria-pressed="true">This Section</button>
    <button type="button" class="studio-scope-pill" data-scope-pill="component" aria-pressed="false" disabled>Component</button>
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

// §6.1.6 toolbar layout cluster: compact per-type control strips over the
// SAME data-container-prop/data-container-group hooks the inspector Layout
// tab uses — one populate/collect implementation, two hosts. Toolbar copies
// carry lg-tb- ids (unique) + aria-labels instead of visible labels.
const TOOLBAR_LAYOUT_TYPES: ReadonlyArray<{ type: string; keys: readonly string[] }> = [
  { type: "Stack", keys: ["direction", "gap", "align"] },
  { type: "GridContainer", keys: ["columnsDesktop", "columnsTablet", "columnsMobile", "gap"] },
  { type: "Columns", keys: ["ratio", "mobile"] },
  { type: "CardPanel", keys: ["width", "padding", "radius", "shadow", "background"] },
];

function renderToolbarLayoutCluster(design: FunnelDesign): string {
  const groups = TOOLBAR_LAYOUT_TYPES.map((entry) => {
    const spec = CONTAINER_PROP_CONTROLS.find((g) => g.type === entry.type);
    const controls = (spec?.controls ?? [])
      .filter((ctl) => entry.keys.includes(ctl.key))
      .map(
        (ctl) =>
          `<select id="lg-tb-${escapeHtml(entry.type)}-${escapeHtml(ctl.key)}" class="form-input studio-tb-select" data-container-prop="${escapeHtml(ctl.key)}" data-container-kind="${ctl.kind}" aria-label="${escapeHtml(ctl.label)}" title="${escapeHtml(ctl.label)}"><option value="">${escapeHtml(ctl.label)}: default</option>${options(ctl.values ?? [])}</select>`,
      )
      .join("");
    return `<span class="studio-tb-group" data-container-group="${escapeHtml(entry.type)}" hidden>${controls}</span>`;
  }).join("");
  // Choice-grid quick layout (§6.5 "layout(columns/gap)") — design_overrides
  // keys through the SAME data-inspector-override hooks as the Design tab.
  const gapOptions = (curatedTokenOptions(design)["gridGap"] ?? [])
    .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`)
    .join("");
  const choiceLayout = `<span class="studio-tb-group" data-toolbar-choice-layout hidden>
    <select id="lg-tb-choice-columns" class="form-input studio-tb-select" data-inspector-override="columns" aria-label="Card columns" title="Card columns"><option value="">Columns: inherit</option>${options([2, 3, 4, 5])}</select>
    <select id="lg-tb-choice-gap" class="form-input studio-tb-select" data-inspector-override="gridGap" aria-label="Answer-grid gap token" title="Answer-grid gap token"><option value="">Gap: inherit</option>${gapOptions}</select>
  </span>`;
  return `<span class="studio-tb-cluster" data-toolbar-cluster="layout" hidden>${groups}${choiceLayout}</span>`;
}

// §6.1 anatomy 1–9, left → right. The toolbar is ALWAYS visible (§6.5 row 1:
// nothing selected still shows breadcrumb(root) · pills · undo/redo ·
// viewport); the island toggles the per-selection clusters (pure
// toolbarClustersFor — the §6.5 matrix).
function renderCanvasToolbar(design: FunnelDesign): string {
  const textRoles: ReadonlyArray<{ value: string; label: string }> = [
    { value: "QuestionHeadline", label: "Headline" },
    { value: "Subheadline", label: "Subheadline" },
    { value: "CategoryLabel", label: "Kicker" },
    { value: "HelperText", label: "Helper" },
    { value: "LegalNote", label: "Legal" },
  ];
  const textRoleOptions = textRoles
    .map((r) => `<option value="${escapeHtml(r.value)}">${escapeHtml(r.label)}</option>`)
    .join("");
  return `<div class="studio-toolbar" data-studio-selection-toolbar data-studio-canvas-toolbar>
    <nav class="studio-breadcrumb" data-studio-breadcrumb aria-live="polite" aria-label="Selection breadcrumb"></nav>
    ${renderScopePillsMarkup()}
    <span class="studio-tb-cluster" data-toolbar-cluster="undo">
      <button type="button" class="btn btn-sm btn-outline" data-studio-act="undo" disabled title="Undo (&#8984;Z)" aria-label="Undo">&#8630;</button>
      <button type="button" class="btn btn-sm btn-outline" data-studio-act="redo" disabled title="Redo (&#8679;&#8984;Z)" aria-label="Redo">&#8631;</button>
    </span>
    <span class="studio-tb-cluster" data-toolbar-cluster="viewport" role="group" aria-label="Canvas viewport">
      <button type="button" class="btn btn-sm btn-secondary active" data-canvas-viewport="desktop" aria-pressed="true">Desktop 1280</button>
      <button type="button" class="btn btn-sm btn-secondary" data-canvas-viewport="mobile" aria-pressed="false">Mobile 375</button>
    </span>
    <span class="studio-tb-cluster" data-toolbar-cluster="structure" hidden>
      <button type="button" class="btn btn-sm btn-outline" data-studio-act="move-up" aria-label="Move up">&#8593;</button>
      <button type="button" class="btn btn-sm btn-outline" data-studio-act="move-down" aria-label="Move down">&#8595;</button>
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
    ${renderToolbarLayoutCluster(design)}
    <span class="studio-tb-cluster" data-toolbar-cluster="text" hidden>
      <select id="lg-tb-text-role" class="form-input studio-tb-select" data-text-role aria-label="Type role" title="Type role (maps to the design type slots)">${textRoleOptions}</select>
      <span data-toolbar-text-color hidden><select id="lg-tb-text-color" class="form-input studio-tb-select" data-inspector-override="featureColor" aria-label="Text color role" title="Text color role"><option value="">Color: inherited</option>${roleSelectOptions()}</select></span>
    </span>
    <span class="studio-tb-cluster" data-toolbar-cluster="component" hidden>
      <button type="button" class="btn btn-sm btn-outline" data-toolbar-add-choice hidden>+ Add choice</button>
      <button type="button" class="studio-chip" data-toolbar-autoadvance hidden aria-pressed="false" title="Reflects the Section&#8217;s Continue behavior — click to toggle">Auto-advance: off</button>
      <span data-tb-selected-role="button" hidden><select id="lg-tb-selected-button" class="form-input studio-tb-select" data-inspector-override="buttonBackground" aria-label="Selected-state style role (button background)" title="Selected-state style role"><option value="">Selected style: inherited</option>${roleSelectOptions()}</select></span>
      <span data-tb-selected-role="icon" hidden><select id="lg-tb-selected-icon" class="form-input studio-tb-select" data-inspector-override="iconColor" aria-label="Selected-state style role (icon color)" title="Selected-state style role"><option value="">Selected style: inherited</option>${roleSelectOptions()}</select></span>
      <span data-toolbar-searchable-wrap hidden><button type="button" class="btn btn-sm btn-outline" data-toolbar-searchable aria-pressed="false" title="Searchable dropdown — switches the component type (§5.5)">Searchable: off</button></span>
      <span data-toolbar-input-quick hidden>
        <label class="lg-check studio-tb-check"><input type="checkbox" data-inspector-field="required" aria-label="Required" /> Required</label>
        <input id="lg-tb-placeholder" class="form-input studio-tb-select" type="text" data-inspector-field="placeholder" placeholder="Placeholder" aria-label="Placeholder" />
        <button type="button" class="btn btn-sm btn-outline" data-toolbar-open-validation title="Open the Validation tab">Validation&#8230;</button>
      </span>
    </span>
    <span class="studio-tb-cluster" data-toolbar-cluster="choice" hidden>
      <span class="studio-chip" data-choice-value-chip title="Internal value — opens its Choices row">value</span>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="image">Image / icon&#8230;</button>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="label">Edit label</button>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="badge" aria-pressed="false">Badge</button>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="disabled" aria-pressed="false">Disabled</button>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="duplicate">Duplicate choice</button>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="left" aria-label="Move choice left">&#8592;</button>
      <button type="button" class="btn btn-sm btn-outline" data-choice-act="right" aria-label="Move choice right">&#8594;</button>
      <button type="button" class="btn btn-sm btn-danger" data-choice-act="delete">Delete choice</button>
    </span>
    <span class="studio-tb-cluster" data-toolbar-cluster="preset" hidden>
      <select id="lg-tb-preset-apply" class="form-input studio-tb-select" data-preset-apply aria-label="Apply preset"><option value="">Apply preset&#8230;</option></select>
      <button type="button" class="btn btn-sm btn-outline" data-preset-save>Save selection as preset&#8230;</button>
    </span>
    <span class="studio-toolbar-problems" data-toolbar-problems role="status" aria-live="polite" hidden></span>
  </div>`;
}

export function renderStudioCanvas(
  content: LeadgenSectionContent,
  design: FunnelDesign,
  ctx?: { headline_text: string; subheadline_text: string | null },
): string {
  const empty = !Array.isArray(content.components) || content.components.length === 0;
  return `<div class="studio-canvas" data-studio-canvas>
  <div class="studio-canvas-head">
    <h3 class="card-title">Canvas</h3>
    <button type="button" class="btn btn-sm btn-outline" data-studio-frame-hint aria-pressed="false" title="Show a dimmed, generic frame skeleton for spatial context — presentation-only, edited in the Quote Builder">Frame hint</button>
  </div>
  ${renderCanvasToolbar(design)}
  <p class="studio-pending-note" data-studio-pending-note hidden role="status" aria-live="polite"></p>
  <p class="studio-refusal alert alert-error" data-studio-drop-refusal hidden role="status" aria-live="polite"></p>
  <div class="studio-canvas-surface" id="lg-studio-canvas" tabindex="0" aria-label="Section canvas — click a component to select; arrow keys reorder; Delete removes; Escape selects the parent">
    ${renderFrameHintSkeleton("top")}
    <div class="studio-canvas-render" id="lg-studio-canvas-render">${studioCanvasDocument(content, design, ctx)}</div>
    ${renderFrameHintSkeleton("bottom")}
    <div class="studio-canvas-empty" data-studio-canvas-empty${empty ? "" : " hidden"}><p>No components yet.</p><p class="form-help">Add a component from the library on the left, or drag one in.</p></div>
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// §8.6 inspector (right) — tabs per selection
// ---------------------------------------------------------------------------

const CONDITION_OP_OPTIONS: ReadonlyArray<string> = ["eq", "neq", "gt", "lt", "gte", "lte", "range", "in", "not_in"];

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

// FIX 4b: `mobileBehavior` is NOT listed — no renderer consumes it, so its
// Design-tab control was a dead write and is REMOVED. The schema key stays
// legal (content-schema CURATED_DESIGN_OVERRIDE_KEYS unchanged) so stored
// legacy data keeps validating.
const TOKEN_CONTROL_LABELS: Record<string, string> = {
  iconColor: "Icon color token",
  columns: "Card columns (2–5)",
  featureColor: "Feature color token",
  rangeColor: "Range fill token",
  buttonBackground: "Button background token",
  buttonText: "Button text token",
  gridGap: "Answer-grid gap token",
};

// §9.4 operator labels for the COLOR-typed rows (role swatch rows — no
// "token" vocabulary on this surface).
const ROLE_CONTROL_LABELS: Record<string, string> = {
  iconColor: "Icon color",
  featureColor: "Feature color",
  rangeColor: "Range fill",
  buttonBackground: "Button color",
  buttonText: "Button text color",
};

function renderDesignPanel(design: FunnelDesign): string {
  const tokenOptions = curatedTokenOptions(design);
  const curated: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);
  const colorTyped: ReadonlySet<string> = new Set(COLOR_TYPED_OVERRIDE_KEYS);
  const selects = Object.keys(TOKEN_CONTROL_LABELS)
    .filter((key) => curated.has(key))
    .map((key) => {
      // §9.4 (wave 2): COLOR-typed keys are role swatch rows — option VALUES
      // are the 14 §9.1 ROLE NAMES (picking writes the role, never hex), an
      // inheritance tag + source line, "Reset to inherited" once overridden,
      // and the legacy-hex "Custom color (legacy) — [Convert…]" affordance
      // (island-populated from the stored value). NO hex text renders here.
      if (colorTyped.has(key)) {
        return `<div class="form-group lg-inspector-field studio-role-row" data-override-row="${escapeHtml(key)}">
  <label class="form-label" for="lg-inspector-${escapeHtml(key)}">${escapeHtml(ROLE_CONTROL_LABELS[key] ?? key)}</label>
  <div class="studio-role-line">
    <span class="studio-role-swatch" data-override-swatch="${escapeHtml(key)}" aria-hidden="true"></span>
    <select id="lg-inspector-${escapeHtml(key)}" class="form-input" data-inspector-override="${escapeHtml(key)}"><option value="">Inherited (design default)</option>${roleSelectOptions()}</select>
    <button type="button" class="btn btn-sm btn-outline" data-override-reset="${escapeHtml(key)}" hidden>Reset to inherited</button>
  </div>
  <p class="form-help studio-role-source" data-override-source="${escapeHtml(key)}"></p>
  <p class="form-help studio-role-legacy" data-override-legacy="${escapeHtml(key)}" hidden>Custom color (legacy) &#8212; <button type="button" class="studio-link-btn" data-override-convert="${escapeHtml(key)}">Convert to a theme color</button></p>
</div>`;
      }
      const opts = (tokenOptions[key] ?? [])
        .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(`${o.label} (${o.value})`)}</option>`)
        .join("");
      // §7.4: the no-override state reads as an inherited value ("Inherited
      // (design default)") — re-picking it IS the "Reset to inherited"
      // affordance for the structural keys. The row wrapper carries
      // data-override-row so the island can GATE dead-write rows per type
      // (FIX 4b: columns/gridGap render only for the card grids).
      return `<div class="form-group lg-inspector-field" data-override-row="${escapeHtml(key)}">
  <label class="form-label" for="lg-inspector-${escapeHtml(key)}">${escapeHtml(TOKEN_CONTROL_LABELS[key])}</label>
  <select id="lg-inspector-${escapeHtml(key)}" class="form-input" data-inspector-override="${escapeHtml(key)}"><option value="">Inherited (design default)</option>${opts}</select>
</div>`;
    })
    .join("");
  // A6 (05 §5.5): image fit is a COMPONENT prop on ImageCardAnswerGrid — a
  // Design-tab control (it is presentation, §7.3 "Design | any visual
  // selection"), island-gated to the image grid only. Writes props.image_fit
  // through the standard data-inspector-field collect path.
  const imageFit = `<div class="form-group lg-inspector-field" data-image-fit-wrap hidden>
  <label class="form-label" for="lg-inspector-image-fit">Image fit (how card photos fill their box)</label>
  <select id="lg-inspector-image-fit" class="form-input" data-inspector-field="image_fit">
    <option value="">Default (browser fit)</option>
    <option value="cover">Cover — fill the card, may crop</option>
    <option value="contain">Contain — show the whole image</option>
  </select>
</div>`;
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
${imageFit}
${selects}`;
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
    controls: [{ key: "size", label: "Size token", kind: "enum", values: LEADGEN_GAP_TOKENS }],
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

function renderLayoutPanel(): string {
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
  ${renderScopePillsMarkup()}
  <p class="studio-scope-affects" data-scope-affects>Affects: changes apply everywhere this Section is used.</p>
</div>`;
}

// The full tabbed inspector. Panels are server-rendered ONCE; the island
// toggles tab/panel visibility per the selected node's type metadata and
// populates/collects values (data-inspector-field / data-inspector-override /
// data-inspector-cond / data-choice-field / data-container-prop hooks).
// §7.3: the tab STRIP is dynamic per selection (availableTabsFor island-side)
// — never a fixed strip; §7.4 relabeling keeps every visible string in
// operator words.
export function renderStudioInspector(design: FunnelDesign): string {
  const opOptions = options(CONDITION_OP_OPTIONS);
  const patternOptions = options(PATTERN_PRESETS);
  const contentInputs = CONTENT_CONTROLS.map(
    (ctl) => `<div class="form-group lg-inspector-field" data-content-prop="${escapeHtml(ctl.key)}" hidden>
  <label class="form-label" for="lg-content-${escapeHtml(ctl.key)}">${escapeHtml(ctl.label)}</label>
  <input id="lg-content-${escapeHtml(ctl.key)}" class="form-input" type="text" data-inspector-field="${escapeHtml(ctl.key)}" />
</div>`,
  ).join("");

  const tabs: ReadonlyArray<{ key: string; label: string }> = [
    { key: "content", label: "Content" },
    { key: "choices", label: "Choices" },
    { key: "layout", label: "Layout" },
    { key: "design", label: "Design" },
    { key: "validation", label: "Validation" },
    { key: "maps", label: "Maps" },
    { key: "dependencies", label: "Dependencies" },
    { key: "mapping", label: "Mapping" },
    { key: "advanced", label: "Advanced" },
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

  <div class="studio-panel" data-studio-panel="content" role="tabpanel">
    <div class="form-group lg-inspector-field" data-bound-content hidden>
      <label class="form-label" for="lg-bound-shared-text" data-bound-content-label>Question headline (shared with the Section header above)</label>
      <input id="lg-bound-shared-text" class="form-input" type="text" data-bound-shared-input />
    </div>
    ${contentInputs}
    <div class="form-group lg-inspector-field" data-default-wrap="yesno" hidden>
      <label class="form-label" for="lg-default-yesno">Default answer (§5.5)</label>
      <select id="lg-default-yesno" class="form-input" data-default-control="yesno">
        <option value="">No default — the visitor picks</option>
        <option value="true">Yes (pre-selected)</option>
        <option value="false">No (pre-selected)</option>
      </select>
      <p class="form-help">A default pre-selects the answer — the visitor must still confirm it before continuing (§5.5).</p>
    </div>
    <div class="form-group lg-inspector-field" data-default-wrap="range" hidden>
      <label class="form-label" for="lg-default-range">Default value (§5.5)</label>
      <input id="lg-default-range" class="form-input" type="number" data-default-control="range" placeholder="Starts at the minimum when empty" />
      <p class="form-help">Where the slider starts. Leave empty to start at the minimum.</p>
    </div>
    <div class="form-group lg-inspector-field" data-default-wrap="dropdown" hidden>
      <label class="form-label" for="lg-default-dropdown">Default choice (§5.5)</label>
      <select id="lg-default-dropdown" class="form-input" data-default-control="dropdown"><option value="">No default — the visitor picks</option></select>
      <p class="form-help">Pre-selects one of this component&#8217;s choices.</p>
    </div>
    <p class="form-help" data-content-empty hidden>This component has no editable copy — see the Layout / Advanced tabs.</p>
  </div>

  <div class="studio-panel" data-studio-panel="choices" role="tabpanel" hidden>
    <div class="lg-choice-list" data-inspector-choices></div>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-choice-add">+ Add choice</button>
    <div class="form-group lg-inspector-field studio-othergroup">
      <label class="lg-check"><input type="checkbox" data-choicedisplay="otherGroupEnabled" /> Enable &quot;Other&quot; group (B9 §6.4)</label>
      <input class="form-input" type="text" data-choicedisplay="otherGroupLabel" placeholder="Other-group label (default: Other)" />
      <label class="lg-check"><input type="checkbox" data-choicedisplay="searchableOther" /> Searchable Other panel</label>
    </div>
    <div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-choice-bulk">Bulk paste (one per line: label = value)</label>
      <textarea id="lg-choice-bulk" class="form-input" rows="3" data-choice-bulk placeholder="Toyota = toyota&#10;Honda = honda"></textarea>
      <button type="button" class="btn btn-sm btn-secondary" id="lg-choice-bulk-apply">Apply bulk paste</button>
    </div>
    <p class="form-help" data-choices-c1-note>Answer choices own display and normalization only. Provider values are set per Offer in the Mapping tab &#8212; each row&#8217;s chip shows them read-only.</p>
  </div>

  <div class="studio-panel" data-studio-panel="layout" role="tabpanel" hidden>
    <p class="form-help">§8.5 tokenized layout props — dropdowns of the allowed values only.</p>
    ${renderLayoutPanel()}
  </div>

  <div class="studio-panel" data-studio-panel="design" role="tabpanel" hidden>
    ${renderDesignPanel(design)}
  </div>

  <div class="studio-panel" data-studio-panel="validation" role="tabpanel" hidden>
    <div class="form-group lg-inspector-field"><label class="lg-check"><input type="checkbox" data-inspector-field="required" /> Required</label></div>
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
      <label class="form-label" for="lg-vprop-pattern">Pattern preset (§6.5)</label>
      <select id="lg-vprop-pattern" class="form-input" data-inspector-vprop="pattern_preset">${patternOptions}</select>
      <input class="form-input" type="text" data-inspector-vprop="pattern" placeholder="custom regex (custom preset only)" hidden />
    </div>
    <div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-vprop-error">Error text override</label>
      <input id="lg-vprop-error" class="form-input" type="text" data-inspector-vprop="error_text" />
    </div>
    <p class="form-help" data-range-format-note hidden>Provider output format is set per Offer in the Mapping tab (value transform) &#8212; sliders store the plain number here (§5.5).</p>
  </div>

  <div class="studio-panel" data-studio-panel="maps" role="tabpanel" hidden>
    <p class="form-help">§8.8 field-level Google-Maps config (browser Places leg). Per-field config WINS over the legacy global toggle. Absent browser key &#8658; graceful no-op — manual entry keeps working.</p>
    <div class="form-group lg-inspector-field" data-maps-mode="address"><label class="lg-check"><input type="checkbox" data-maps-flag="enable_autocomplete" /> Enable address autocomplete</label></div>
    <div class="form-group lg-inspector-field" data-maps-mode="address"><label class="lg-check"><input type="checkbox" data-maps-flag="validate_full_address" /> Validate full address</label></div>
    <div class="form-group lg-inspector-field" data-maps-mode="zip"><label class="lg-check"><input type="checkbox" data-maps-flag="validate_zip" /> Validate ZIP</label></div>
    <div class="form-group lg-inspector-field" data-maps-mode="both">
      <label class="form-label" for="lg-maps-autofill-state">Autofill state &#8594; field</label>
      <select id="lg-maps-autofill-state" class="form-input" data-maps-fill="autofill_state"><option value="">&#8212; none &#8212;</option></select>
    </div>
    <div class="form-group lg-inspector-field" data-maps-mode="both">
      <label class="form-label" for="lg-maps-autofill-city">Autofill city &#8594; field</label>
      <select id="lg-maps-autofill-city" class="form-input" data-maps-fill="autofill_city"><option value="">&#8212; none &#8212;</option></select>
    </div>
    <div class="form-group lg-inspector-field" data-maps-mode="address">
      <label class="form-label" for="lg-maps-autofill-zip">Autofill ZIP &#8594; field</label>
      <select id="lg-maps-autofill-zip" class="form-input" data-maps-fill="autofill_zip"><option value="">&#8212; none &#8212;</option></select>
    </div>
    <div class="form-group lg-inspector-field" data-maps-mode="address"><label class="lg-check"><input type="checkbox" data-maps-flag="normalize_address_line" /> Normalize address line</label></div>
    <p class="form-help" data-maps-zip-note hidden>ZIP features ride Places autocomplete on the ZIP input — the saved config carries <code>enable_autocomplete</code> automatically (the runtime wiring gate).</p>
  </div>

  <div class="studio-panel" data-studio-panel="dependencies" role="tabpanel" hidden>
    <fieldset class="form-group lg-inspector-field lg-inspector-conditional">
      <legend class="form-label">Show this component IF (§6.10)</legend>
      <p class="form-help studio-cond-sentence" data-cond-sentence aria-live="polite"></p>
      <select class="form-input" data-inspector-cond="when" aria-label="Depends on field"><option value="">— always visible —</option></select>
      <select class="form-input" data-inspector-cond="op" aria-label="Condition operator">${opOptions}</select>
      <select class="form-input" data-inspector-cond="value-bool" aria-label="Boolean value" hidden><option value="true">true</option><option value="false">false</option></select>
      <select class="form-input" data-inspector-cond="value-enum" aria-label="Choice value" hidden></select>
      <input class="form-input" type="text" data-inspector-cond="value" placeholder="value" aria-label="Condition value" />
      <input class="form-input" type="number" data-inspector-cond="from" placeholder="from" aria-label="Range from" hidden />
      <input class="form-input" type="number" data-inspector-cond="to" placeholder="to" aria-label="Range to" hidden />
      <input class="form-input" type="text" data-inspector-cond="values" placeholder="values, comma-separated" aria-label="Condition values" hidden />
    </fieldset>
    <fieldset class="form-group lg-inspector-field lg-inspector-conditional" data-reqcond-wrap hidden>
      <legend class="form-label">Require this component IF (§7.3)</legend>
      <p class="form-help studio-cond-sentence" data-reqcond-sentence aria-live="polite"></p>
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

  <div class="studio-panel" data-studio-panel="mapping" role="tabpanel" hidden>
    <p class="form-help">How this component&#39;s answer maps to each selected Offer. Quick-map picks the Offer&#39;s field — never a typed path.</p>
    <div class="studio-inspector-mapping" data-studio-inspector-mapping></div>
    <button type="button" class="btn btn-sm btn-outline" data-studio-open-mapping-drawer>Open Offer mapping drawer</button>
  </div>

  <div class="studio-panel" data-studio-panel="advanced" role="tabpanel" hidden>
    <div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-inspector-internal-field">Internal field (normalized answer name)</label>
      <input id="lg-inspector-internal-field" class="form-input" type="text" data-inspector-field="internal_field" placeholder="e.g. currently_insured" />
      <p class="alert alert-error studio-rename-warning" data-studio-rename-warning hidden role="status" aria-live="polite"></p>
    </div>
    <div class="form-group lg-inspector-field">
      <label class="form-label" for="lg-inspector-question-key">Question key</label>
      <input id="lg-inspector-question-key" class="form-input" type="text" data-inspector-field="question_key" />
    </div>
    <div class="form-group lg-inspector-field">
      <span class="form-label">Debug ids (read-only)</span>
      <code class="studio-debug-id" data-studio-debug-id></code>
    </div>
    <div class="form-group lg-inspector-field">
      <span class="form-label">Bind marker (read-only, §5.2)</span>
      <code class="studio-debug-id" data-studio-bind-marker></code>
    </div>
    <details class="studio-advanced-json">
      <summary>Raw node JSON (Advanced — the only raw JSON surface, §6.14)</summary>
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
function renderPreviewPanel(): string {
  return `<div class="lg-preview-controls" data-lg-preview-controls>
  <div class="studio-frame-preview" data-studio-frame-preview role="group" aria-label="Preview in Quote frame">
    <span class="form-help">Preview in Quote frame:</span>
    <select class="form-input lg-preview-design" data-frame-pick-quote aria-label="Quote"><option value="">&#8212; no frame (unit only) &#8212;</option></select>
    <select class="form-input lg-preview-design" data-frame-pick-funnel aria-label="Funnel" disabled><option value="">Funnel&#8230;</option></select>
    <select class="form-input lg-preview-design" data-frame-pick-variant aria-label="Variant" disabled><option value="">Variant&#8230;</option></select>
    <select class="form-input lg-preview-design" data-frame-pick-site aria-label="Site branding" disabled><option value="">&#8212; no site branding &#8212;</option></select>
    <p class="form-help studio-frame-empty" data-frame-preview-empty hidden>This Section isn’t used in any Quote yet — previewing in the default frame.</p>
  </div>
  <div class="lg-viewport-toggle" role="group" aria-label="Preview viewport">
    <button type="button" class="btn btn-sm btn-secondary active" data-preview-viewport="desktop" aria-pressed="true">Desktop</button>
    <button type="button" class="btn btn-sm btn-secondary" data-preview-viewport="mobile" aria-pressed="false">Mobile</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-overlay-toggle aria-pressed="false" title="Chip every answer component on the canvas with its Offer-mapping status">Offer mapping overlay</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-preview-refresh">Refresh preview</button>
    <label class="form-help" for="lg-preview-design">Design:</label>
    <select id="lg-preview-design" class="form-input lg-preview-design" data-preview-design aria-label="Preview under a funnel design (§8.9)">
      <option value="" selected>Default design</option>
      ${designPickerOptions()}
    </select>
  </div>
  <div class="lg-states-simulator" role="group" aria-label="State simulator (§14.9)">
    <span class="form-help">Simulate state:</span>
    <button type="button" class="btn btn-sm btn-outline active" data-sim-state="default" aria-pressed="true">Default</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="selected" aria-pressed="false">Selected</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="error" aria-pressed="false">Error</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="dependency" aria-pressed="false">Dependency</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="validation_success" aria-pressed="false">Validation success</button>
    <button type="button" class="btn btn-sm btn-outline" data-sim-state="validation_error" aria-pressed="false">Validation error</button>
  </div>
  <div class="lg-dependency-panel" data-dependency-panel hidden>
    <label class="form-label" for="lg-dependency-answers">Sample answers (JSON, keyed by internal field) — drives the dependency/selected/error/validation sims (§9.2)</label>
    <textarea id="lg-dependency-answers" class="form-input" data-dependency-answers rows="3" aria-label="Sample answers for the state sims" placeholder='{ "currently_insured": true }'></textarea>
    <button type="button" class="btn btn-sm btn-secondary" id="lg-dependency-apply">Apply sample answers</button>
    <p class="lg-dependency-status" data-dependency-status role="status" aria-live="polite"></p>
  </div>
  <div class="studio-events" data-studio-events-panel>
    <div class="studio-events-head">
      <span class="form-label">Events that would fire (§8.9 / §9.1)</span>
      <button type="button" class="btn btn-sm btn-outline" data-studio-events-clear>Clear</button>
    </div>
    <p class="form-help" data-studio-events-note>The preview loads the REAL runtime bundle in preview mode (data-lg-preview="1"): beacons are suppressed and every would-fire event is listed here instead. Interact with the preview to see answer/continue events.</p>
    <ol class="studio-events-list" data-studio-events-list aria-live="polite"></ol>
  </div>
  <p id="lg-preview-error" class="alert alert-error" hidden role="alert"></p>
  <iframe id="lg-preview-frame" class="lg-preview-frame" title="Section preview" sandbox="allow-scripts"></iframe>
  <iframe id="lg-events-probe-frame" class="lg-events-probe-frame" title="Events probe (runtime preview document)" sandbox="allow-scripts" aria-hidden="true" tabindex="-1"></iframe>
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

export function renderStudioDrawer(summary: StudioMappingSummary, answerMapCount: number): string {
  const mappingSummary = summary.publishable
    ? `<span class="badge badge-published" data-publishable="true">Publishable</span>`
    : `<span class="badge badge-archived" data-publishable="false">Blocked from publish (§12.11)</span>`;
  const missing =
    summary.required_missing_total > 0
      ? `<span class="lg-mapping-missing" data-required-missing="${summary.required_missing_total}">${summary.required_missing_total} required mapping${summary.required_missing_total === 1 ? "" : "s"} missing</span>`
      : `<span class="lg-mapping-missing" data-required-missing="0">All required fields mapped</span>`;
  const header = MAPPING_TABLE_COLUMNS.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("");
  // The §8.7 panel: SSR renders the SKELETON (summary, E9 empty-state slot,
  // table head, expansion regions); the island fills it from
  // GET /sections/:id/offers + the live answer_maps model. Raw numeric offer
  // ids, free-text paths and raw JSON maps do NOT exist on this surface —
  // pickers only (Advanced drawer = the per-NODE raw JSON, §6.14).
  return `<div class="studio-drawer" data-studio-drawer>
  <div class="studio-tabs" role="tablist" aria-label="Studio drawer tabs">
    <button type="button" class="studio-tab" role="tab" data-studio-drawer-tab="mapping" aria-selected="false">Offer mapping</button>
    <button type="button" class="studio-tab" role="tab" data-studio-drawer-tab="validation" aria-selected="false">Validation</button>
    <button type="button" class="studio-tab" role="tab" data-studio-drawer-tab="design" aria-selected="false">Design overrides</button>
    <button type="button" class="studio-tab active" role="tab" data-studio-drawer-tab="preview" aria-selected="true">Preview &amp; debug</button>
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
  return `${renderStudioTopBar(view, summary, statusPillHtml, initialIssueCount(view.content))}
${renderStudioSettings(view, mapsKeyConfigured)}
${mapsBanner}
<div class="lg-editor-grid studio-grid">
  <div class="card studio-cell-library">${renderStudioLibrary(design, view.content)}</div>
  <div class="card studio-cell-canvas">${renderStudioCanvas(view.content, design, { headline_text: view.headline_text, subheadline_text: view.subheadline_text })}</div>
  <div class="card studio-cell-inspector">${renderStudioInspector(design)}</div>
</div>
${renderStudioDrawer(summary, answerMapCount)}
${renderStudioMediaPicker(aiImageAvailable)}
${renderStudioSeedData()}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export const SECTION_STUDIO_STYLES = `
.studio-topbar{display:flex;align-items:flex-end;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.studio-topbar .form-group{margin:0}
.studio-name{min-width:220px}
.studio-activity,.studio-vertical{min-width:140px}
.studio-chip{font-size:12px;border-radius:999px;padding:4px 10px;border:1px solid var(--c-border);background:var(--c-surface);cursor:pointer}
.studio-chip-validation[data-issue-count="0"]{color:#0f5132;background:#d1e7dd;border-color:#badbcc}
.studio-chip-validation:not([data-issue-count="0"]){color:#842029;background:#f8d7da;border-color:#f5c2c7}
.studio-settings{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:12px}
@media (max-width:640px){.studio-settings{grid-template-columns:1fr}}
.lg-editor-grid{display:grid;grid-template-columns:280px 1fr 380px;gap:16px;align-items:start}
@media (max-width:1023px){.lg-editor-grid{grid-template-columns:1fr}}
.lg-editor-spacer{flex:1}
.lg-maps-note{color:var(--c-muted);font-size:12px}
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
.studio-canvas-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.studio-breadcrumb{font-size:12px;color:var(--c-muted);font-variant-numeric:tabular-nums}
.studio-toolbar{display:flex;gap:4px;flex-wrap:wrap;margin:8px 0}
.studio-pending-note{font-size:12px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:4px 8px}
.studio-refusal{margin:8px 0}
.studio-canvas-surface{border:1px dashed var(--c-border);border-radius:8px;min-height:320px;padding:12px;position:relative;background:#fff;overflow:auto}
.studio-canvas-surface:focus-visible{outline:2px solid var(--c-primary);outline-offset:2px}
.studio-canvas-render [data-question-id]{cursor:pointer}
.studio-canvas-render .studio-selected-node{outline:2px solid var(--c-primary);outline-offset:2px;border-radius:4px}
.studio-canvas-render .studio-drop-before{box-shadow:0 -3px 0 0 var(--c-primary)}
.studio-canvas-render .studio-drop-after{box-shadow:0 3px 0 0 var(--c-primary)}
.studio-canvas-render .studio-drop-into{outline:2px dashed var(--c-primary);outline-offset:-2px}
.studio-canvas-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--c-muted);pointer-events:none}
/* §5.4 frame-hint skeleton: dimmed, generic, NON-interactive (presentation only) */
.studio-frame-skeleton{opacity:.35;pointer-events:none;user-select:none;margin:0 0 10px}
.studio-frame-skeleton[data-studio-frame-skeleton="bottom"]{margin:10px 0 0}
.studio-skel-header{display:flex;align-items:center;gap:8px;border:1px dashed var(--c-border);border-radius:6px;padding:8px 10px;background:var(--c-surface)}
.studio-skel-logo{width:28px;height:12px;border-radius:3px;background:var(--c-border);display:inline-block}
.studio-skel-bar{flex:1;height:8px;border-radius:4px;background:var(--c-border);display:inline-block}
.studio-skel-bar-short{flex:0 0 30%}
.studio-skel-progress{height:4px;border-radius:2px;background:var(--c-border);margin-top:6px}
.studio-skel-footer{display:flex;gap:8px;border:1px dashed var(--c-border);border-radius:6px;padding:8px 10px;background:var(--c-surface)}
/* §5.4 amber page-frame badge on legacy frame-scope canvas nodes */
.studio-frame-badge{font-size:11px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:4px 8px;margin:4px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.studio-frame-badge .btn{pointer-events:auto}
.studio-frame-badge-note{flex-basis:100%;font-size:10px;color:#664d03}
/* §5.1 hidden-in-unit chips next to the strip inputs */
.studio-hidden-chip{display:inline-block;font-size:11px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:999px;padding:2px 8px;margin-top:4px}
.studio-hidden-show{border:0;background:none;color:var(--c-primary);cursor:pointer;font-size:11px;padding:0;text-decoration:underline}
/* §5.2 legacy headline link banner */
.studio-bind-banner{font-size:12px;color:#055160;background:#cff4fc;border:1px solid #b6effb;border-radius:8px;padding:8px 10px;margin:0 0 12px}
.studio-bind-banner-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px 0}
.studio-bind-banner-value{font-weight:600}
/* §8.8 linked-field chips + key-missing banner */
.studio-maps-chip{display:inline-block;font-size:10px;color:#055160;background:#cff4fc;border:1px solid #b6effb;border-radius:999px;padding:1px 8px;margin:2px 0 0;pointer-events:none;user-select:none}
.studio-maps-banner{font-size:12px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:6px 10px;margin:0 0 12px}
/* §7.1 scope header + §7.2 pills */
.studio-scope-header{border-bottom:1px solid var(--c-border);padding:0 0 8px;margin:0 0 8px;transition:background-color .3s ease}
.studio-scope-header.studio-scope-flash{background:#fff3cd}
.studio-scope-editing{font-size:13px;margin:0 0 6px}
.studio-scope-affects{font-size:11px;color:var(--c-muted);margin:6px 0 0}
.studio-scope-pills{display:flex;gap:4px;flex-wrap:wrap}
.studio-scope-pill{font-size:11px;border-radius:999px;padding:2px 10px;border:1px solid var(--c-border);background:var(--c-surface);cursor:pointer;color:var(--c-muted)}
.studio-scope-pill.active{border-color:var(--c-primary);color:var(--c-primary);font-weight:600}
.studio-scope-pill[disabled]{opacity:.5;cursor:not-allowed}
.studio-frame-pill-picker{display:inline-flex;gap:4px;flex-wrap:wrap;margin-left:6px}
.studio-cond-sentence{font-weight:600;color:var(--c-text,#1a1f36)}
.studio-section-scope-note{margin:0 0 8px}
/* inspector + drawer */
.studio-tabs{display:flex;gap:2px;flex-wrap:wrap;border-bottom:1px solid var(--c-border);margin-bottom:10px}
.studio-tab{border:0;background:none;padding:6px 10px;font-size:12px;cursor:pointer;border-bottom:2px solid transparent;color:var(--c-muted)}
.studio-tab.active{border-bottom-color:var(--c-primary);color:var(--c-primary);font-weight:600}
.studio-tab[hidden]{display:none}
.lg-inspector-heading{font-size:13px;margin:0 0 8px}
.lg-inspector-field{margin-bottom:10px}
.lg-inspector-conditional{display:flex;gap:4px;flex-wrap:wrap;border:0;padding:0;margin:0}
.lg-choice-list{display:flex;flex-direction:column;gap:4px;margin-bottom:6px}
.lg-choice-row{display:flex;gap:4px;flex-wrap:wrap;align-items:center}
.lg-choice-row .form-input{flex:1 1 90px;min-width:0}
.studio-debug-id{font-size:11px;color:var(--c-muted)}
.studio-advanced-json textarea{width:100%;font-family:var(--font-mono,monospace);font-size:11px;margin:6px 0}
.studio-rename-warning{font-size:12px}
.studio-drawer{margin-top:16px;border:1px solid var(--c-border);border-radius:8px;padding:12px;background:var(--c-surface)}
.studio-issue-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.studio-issue-list button{border:0;background:none;color:#842029;cursor:pointer;text-align:left;font-size:12px;padding:2px 0}
.lg-mapping-summary{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 8px}
.lg-mapping-missing{font-size:12px;color:var(--c-muted)}
/* preview (slice-C wiring, unchanged hooks) */
.lg-preview-frame{border:1px solid var(--c-border);border-radius:8px;width:100%;min-height:360px;margin-top:8px;background:#fff}
.lg-preview-frame-mobile{max-width:375px}
.lg-viewport-toggle,.lg-states-simulator{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.lg-preview-design{width:auto;font-size:12px;padding:4px 6px}
.lg-dependency-panel{border:1px dashed var(--c-border);border-radius:6px;padding:8px;margin-bottom:8px}
.lg-dependency-panel textarea{width:100%;font-family:var(--font-mono,monospace);font-size:12px;margin-bottom:6px}
.lg-dependency-status{font-size:12px;margin:6px 0 0}
.lg-dependency-status[data-continue-blocked="true"]{color:#842029}
/* §8.2 activity/vertical pair controls */
.studio-pair{display:flex;gap:4px;align-items:center}
.studio-pair select{min-width:120px}
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
.studio-breadcrumb button{border:0;background:none;color:var(--c-primary);cursor:pointer;font-size:12px;padding:0 2px;text-decoration:underline}
.studio-breadcrumb .studio-crumb-current{color:inherit;text-decoration:none;font-weight:600;cursor:default}
.studio-toolbar-problems{font-size:11px;color:#842029}
.studio-control-invalid{outline:2px solid #dc3545;outline-offset:1px}
/* §6.2 inline canvas editing + choice ops + resize */
.studio-canvas-render [contenteditable="true"]{outline:2px dashed var(--c-primary);outline-offset:2px;cursor:text}
.studio-choice-selected{outline:2px solid #e85d26 !important;outline-offset:2px}
.studio-choice-ghost{border:1px dashed var(--c-border);background:var(--c-surface);color:var(--c-muted);border-radius:8px;min-height:44px;cursor:pointer;font-size:12px}
.studio-choice-x{position:relative;border:0;background:#f8d7da;color:#842029;border-radius:999px;width:16px;height:16px;line-height:1;font-size:10px;cursor:pointer;margin-left:-14px;vertical-align:top}
.studio-resize-handle{position:absolute;right:-6px;top:50%;width:10px;height:32px;margin-top:-16px;border-radius:4px;background:var(--c-primary);opacity:.6;cursor:ew-resize}
/* §9.4 role swatch rows + §9.5 section overrides */
.studio-role-line{display:flex;gap:6px;align-items:center}
.studio-role-swatch{display:inline-block;width:16px;height:16px;border-radius:4px;border:1px solid var(--c-border);flex:0 0 16px}
.studio-role-source{margin:2px 0 0}
.studio-role-legacy{color:#664d03;margin:2px 0 0}
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
/* §12.3 canvas mapping overlay chips */
.studio-mapoverlay-chip{font-size:10px;border-radius:999px;padding:2px 8px;border:1px solid var(--c-border);background:var(--c-surface);color:var(--c-muted);cursor:pointer;display:inline-block;margin:2px 0}
.studio-mapoverlay-chip[data-overlay-state="mapped"]{color:#0f5132;background:#d1e7dd;border-color:#badbcc}
.studio-mapoverlay-chip[data-overlay-state="required-missing"]{color:#842029;background:#f8d7da;border-color:#f5c2c7}
/* §7.3 provider-values chip (C1) */
.studio-provider-chip{font-size:10px;border-radius:999px;padding:1px 8px;border:1px solid var(--c-border);background:var(--c-surface);cursor:pointer;color:var(--c-muted)}
.studio-provider-rows{flex-basis:100%;font-size:11px;border-left:2px solid var(--c-border);padding-left:8px;margin:2px 0}
.studio-provider-rows a{font-size:11px}
/* §5.4 move-to-frame funnel picker */
.studio-funnel-picker{flex-basis:100%;display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:11px}
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

  function markDirty() { dirty = true; }
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
  function overrideRowHidden(rowKey, node) {
    if (rowKey === 'columns' || rowKey === 'gridGap') { return !isCardGridType(node); }
    if (rowKey === 'iconColor') { return !!node && node.type === 'MultiChoiceCardGroup'; }
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
      if (isHexColor(cur)) { return 'Custom color (legacy) \\u2014 not a theme role.'; }
      return roleLabelOf(cur) + ' \\u2014 overridden for this component.';
    }
    var backing = OVERRIDE_BACKING_ROLE[key] || null;
    if (backing !== null) {
      var repointed = (state.design_overrides && state.design_overrides.palette) ? state.design_overrides.palette[backing] : null;
      if (repointed) {
        return 'Inherited: ' + (isHexColor(repointed) ? 'Custom color (legacy)' : roleLabelOf(repointed)) + ' \\u2014 from this Section\\u2019s Design overrides.';
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

  // --- §5.4 Move to Quote frame: the equivalent frame_config_json group ---------
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
  // §5.4: the explicit confirm NAMES the funnel — and, for a container with
  // children, NAMES what happens to them (FIX 1c: the contents are NOT
  // deleted; they splice into this Section where the container stood).
  function moveConfirmMessage(node, funnelName) {
    var contentsNote = '';
    if (isContainerType(node.type) && node.children && node.children.length > 0) {
      contentsNote = ' Its contents stay in this Section.';
    }
    return 'Move this ' + typeLabel(node.type) + ' into the Quote frame of funnel \\u201C' + funnelName + '\\u201D?\\nIt leaves this Section and becomes part of that funnel\\u2019s frame (edited in the Quote Builder).' + contentsNote + ' The Section change saves now.';
  }

  // --- §5.3 mode 5: Preview in Quote frame --------------------------------------
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

  // --- §6.2 inline text editing (dblclick) commit core ---------------------------
  // Bound nodes write the STRIP store (one store, two views); plain copy nodes
  // write props.text/label; choice cards write that choice's label.
  function inlineEditKeyFor(node) {
    if (node.bind !== undefined) { return 'bind'; }
    var cp = typeMeta(node.type).content_props || [];
    if (cp.indexOf('text') !== -1) { return 'text'; }
    if (cp.indexOf('label') !== -1) { return 'label'; }
    return null;
  }
  function commitInlineText(qid, key, text) {
    var ref = findRef(qid);
    if (!ref) { return false; }
    if (key === 'bind') {
      var strip = stripInputFor(ref.node.bind);
      if (strip) { strip.value = text; }
      var mirror = document.querySelector('[data-bound-shared-input]');
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
      if (keyEv.key === 'Enter') { keyEv.preventDefault(); finish(true); }
      else if (keyEv.key === 'Escape') { keyEv.preventDefault(); finish(false); }
    }
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
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

  // --- §8.8 field-level Maps config model helpers -----------------------------
  // The EXACT runtime keys (runtime/maps.ts parseMapsConfig flat spellings):
  // flags per mode + autofill field-picker keys per mode. The UI emits ONLY
  // these keys; parseMapsConfig treats an absent key as off.
  var MAPS_FLAG_KEYS = {
    address: ['enable_autocomplete', 'validate_full_address', 'normalize_address_line'],
    zip: ['validate_zip']
  };
  var MAPS_FILL_KEYS = {
    address: ['autofill_state', 'autofill_city', 'autofill_zip'],
    zip: ['autofill_city', 'autofill_state']
  };
  function mapsConfigOf(node) {
    var m = node && node.props ? node.props.maps : null;
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : null;
  }
  // The autofilled part names, in the runtime's link order (street, city,
  // state, zip) — reading BOTH the flat autofill_* spelling and the nested
  // fills object exactly like parseMapsConfig's pick().
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
  // Maps-enabled = the per-field config switches SOMETHING on (any §8.8 flag
  // — either spelling parseMapsConfig accepts — or an autofill target).
  function nodeMapsEnabled(node) {
    var cfg = mapsConfigOf(node);
    if (!cfg) { return false; }
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
    return node;
  }

  // --- structural mutations (§8.4) — every mutation flows through here --------
  function addComponentAt(type, parentQid, index) {
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
    var at = (typeof index === 'number' && index >= 0 && index <= target.length) ? index : target.length;
    target.splice(at, 0, node);
    afterModelChange();
    return node;
  }
  function insertRelative(qid, where, type) {
    var ref = findRef(qid);
    if (!ref) { return null; }
    var parentQid = ref.parent ? ref.parent.question_id : null;
    return addComponentAt(type, parentQid, ref.index + (where === 'after' ? 1 : 0));
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
  function computeIssues() {
    var issues = [];
    var fieldSeen = {};
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
      if (req.choices && (!node.choices || node.choices.length === 0)) {
        issues.push({ qid: node.question_id, message: label + ' needs at least one choice' });
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
    var region = document.getElementById('lg-studio-canvas-render');
    if (!region) { return; }
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
    var badge = document.createElement('div');
    badge.className = 'studio-frame-badge';
    badge.setAttribute('data-frame-badge', qid);
    var text = document.createElement('span');
    text.appendChild(document.createTextNode('Page-frame element \\u2014 belongs to the Quote frame \\u00B7'));
    badge.appendChild(text);
    var move = document.createElement('button');
    move.type = 'button';
    move.className = 'btn btn-sm btn-outline';
    move.setAttribute('data-frame-move', qid);
    move.title = 'Move this ' + typeLabel(type) + ' into the Quote frame (edited in the Quote Builder).';
    move.appendChild(document.createTextNode('Move to Quote frame'));
    badge.appendChild(move);
    var keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn btn-sm btn-outline';
    keep.setAttribute('data-frame-keep', qid);
    keep.appendChild(document.createTextNode('Keep (legacy)'));
    badge.appendChild(keep);
    // C2 consequence (§5.4): the badge NAMES the activation block.
    var note = document.createElement('span');
    note.className = 'studio-frame-badge-note';
    note.appendChild(document.createTextNode('While a funnel using this Section has a configured frame, activation blocks on this element unless that funnel\\u2019s Advanced legacy override allows it.'));
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
      x = document.createElement('button');
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
        ghost = document.createElement('button');
        ghost.type = 'button';
        ghost.className = 'lg-card studio-choice-ghost';
        ghost.setAttribute('data-choice-ghost', qid);
        ghost.appendChild(document.createTextNode('+ Add choice'));
        nodes[i].appendChild(ghost);
      }
      // §6.2: resize handle on the SELECTED CardPanel — snaps to width presets.
      if (type === 'CardPanel' && qid === selectedQuestionId) {
        nodes[i].style.position = 'relative';
        handle = document.createElement('span');
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
      chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'studio-mapoverlay-chip';
      chip.setAttribute('data-mapping-overlay-chip', qid);
      chip.setAttribute('data-overlay-state', info.required_missing ? 'required-missing' : 'mapped');
      chip.setAttribute('data-overlay-count', String(info.count));
      chip.title = 'Open the Mapping tab for this component';
      chip.appendChild(document.createTextNode(info.required_missing ? 'Required \\u2014 missing' : 'Mapped \\u00B7 ' + info.count + ' Offer' + (info.count === 1 ? '' : 's')));
      chip.addEventListener('click', function () {
        selectComponent(this.getAttribute('data-mapping-overlay-chip'));
        setInspectorTab('mapping');
      });
      if (nodes[i].parentNode) { nodes[i].parentNode.insertBefore(chip, nodes[i]); }
    }
  }
  function applyCanvasDecoration() {
    var region = document.getElementById('lg-studio-canvas-render');
    if (!region) { return; }
    // §8.8 linked-field chips + §5.4 frame badges REBUILD per pass (the region
    // is server HTML — every re-render wipes them, so decoration re-derives
    // from the model).
    var stale = region.querySelectorAll('.studio-maps-chip, .studio-frame-badge, .studio-choice-ghost, .studio-choice-x, .studio-resize-handle, .studio-mapoverlay-chip');
    var i;
    for (i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) { stale[i].parentNode.removeChild(stale[i]); }
    }
    var nodes = region.querySelectorAll('[data-question-id]');
    var qid, base, ref, labels, chip, nodeType;
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('draggable', 'true');
      qid = nodes[i].getAttribute('data-question-id');
      base = withoutClasses(nodes[i].className, [SELECT_CLASS]);
      nodes[i].className = qid === selectedQuestionId ? base + ' ' + SELECT_CLASS : base;
      // §5.4: legacy frame-scope node → amber badge (unless Keep-acknowledged
      // this session). Inserted as a SIBLING above the node element.
      nodeType = nodes[i].getAttribute('data-component-type');
      if (typeMeta(nodeType).scope === 'frame' && keptLegacyFrameNodes[qid] !== true && nodes[i].parentNode) {
        nodes[i].parentNode.insertBefore(buildFrameBadge(qid, nodeType), nodes[i]);
      }
      // chip: "fills: city, state" from the config's autofill keys. Inserted
      // as a SIBLING (the ZIP node element is the <input> itself — it cannot
      // contain children).
      ref = findRef(qid);
      labels = ref ? mapsFillLabels(ref.node) : [];
      if (labels.length > 0 && nodes[i].parentNode) {
        chip = document.createElement('span');
        chip.className = 'studio-maps-chip';
        chip.setAttribute('data-studio-maps-chip', '');
        chip.setAttribute('data-chip-for', qid);
        chip.setAttribute('data-fills', labels.join(','));
        chip.appendChild(document.createTextNode('fills: ' + labels.join(', ')));
        nodes[i].parentNode.insertBefore(chip, nodes[i].nextSibling);
      }
    }
    decorateChoiceCards(region);
    decorateMappingOverlay(region);
  }
  function clearDropClasses() {
    var region = document.getElementById('lg-studio-canvas-render');
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
        return 'Affects: a page-frame element kept inside this Section (legacy) \\u2014 the frame itself is edited in the Quote Builder.';
      }
      return 'Affects: this question unit \\u2014 in every quote that uses this Section.';
    }
    if (usageQuoteCount === null) { return 'Affects: changes apply everywhere this Section is used.'; }
    if (usageQuoteCount === 0) { return 'Affects: not used in any quote yet.'; }
    return 'Affects: used in ' + usageQuoteCount + ' quote' + (usageQuoteCount === 1 ? '' : 's') + '; changes apply everywhere it\\u2019s used.';
  }
  function scopeEditingName(node) {
    if (scopeState === 'choice') { return 'Answer choice \\u201C' + choiceScopeLabel + '\\u201D'; }
    if (scopeState === 'component' && node) { return typeLabel(node.type); }
    return 'This Section (question unit)';
  }
  var scopeFlashTimer = null;
  function renderScopeHeader() {
    var header = document.querySelector('[data-studio-scope-header]');
    if (!header) { return; }
    var node = selectedNode();
    if (scopeState !== 'section' && !node) { scopeState = 'section'; }
    var nameEl = header.querySelector('[data-scope-editing-name]');
    var affectsEl = header.querySelector('[data-scope-affects]');
    var changed = false;
    var newName = scopeEditingName(node);
    if (nameEl && nameEl.textContent !== newName) { nameEl.textContent = newName; changed = true; }
    if (affectsEl) { affectsEl.textContent = scopeAffectsText(node); }
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
    if (!selectedQuestionId) { root.className = 'studio-crumb-current'; }
    root.appendChild(document.createTextNode('This Section'));
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
    var meta = node ? typeMeta(node.type) : {};
    var addChoice = document.querySelector('[data-toolbar-add-choice]');
    if (addChoice) { addChoice.hidden = !node || meta.choice !== true; }
    var auto = document.querySelector('[data-toolbar-autoadvance]');
    if (auto) {
      auto.hidden = !node || meta.choice !== true;
      var on = (state.continue_mode || 'button') === 'auto_advance';
      auto.textContent = on ? 'Auto-advance: on' : 'Auto-advance: off';
      auto.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    var selButton = document.querySelector('[data-tb-selected-role="button"]');
    if (selButton) { selButton.hidden = !node || (node.type !== 'ButtonAnswerGroup' && node.type !== 'TwoButtonYesNo' && node.type !== 'OtherGroupSelector'); }
    // FIX 4b: MultiChoiceCardGroup has NO icon slot — its iconColor swatch was
    // a dead write; the selected-icon role shows only for the two card grids.
    var selIcon = document.querySelector('[data-tb-selected-role="icon"]');
    if (selIcon) { selIcon.hidden = !isCardGridType(node); }
    var inputQuick = document.querySelector('[data-toolbar-input-quick]');
    if (inputQuick) { inputQuick.hidden = !node || !meta.produces || meta.choice === true; }
    // FIX 4b: only renderCardGrid consumes columns/gridGap overrides — the
    // quick layout cluster is gated to the two card grids (ButtonAnswerGroup /
    // dropdowns / MultiChoiceCardGroup wrote dead keys).
    var choiceLayout = document.querySelector('[data-toolbar-choice-layout]');
    if (choiceLayout) { choiceLayout.hidden = !isCardGridType(node); }
    // §5.5: the dropdown searchable toggle SWITCHES the component type.
    var searchWrap = document.querySelector('[data-toolbar-searchable-wrap]');
    var searchBtn = document.querySelector('[data-toolbar-searchable]');
    var isDropdown = !!node && (node.type === 'DropdownQuestion' || node.type === 'SearchableDropdownQuestion');
    if (searchWrap) { searchWrap.hidden = !isDropdown; }
    if (searchBtn && isDropdown) {
      var searchable = node.type === 'SearchableDropdownQuestion';
      searchBtn.textContent = searchable ? 'Searchable: on' : 'Searchable: off';
      searchBtn.setAttribute('aria-pressed', searchable ? 'true' : 'false');
    }
    var textRoleSel = document.querySelector('[data-text-role]');
    if (textRoleSel && node && TEXT_ROLE_TYPES.indexOf(node.type) !== -1) {
      textRoleSel.value = node.type;
      textRoleSel.disabled = node.bind !== undefined;
    }
    var textColor = document.querySelector('[data-toolbar-text-color]');
    if (textColor) { textColor.hidden = !node || node.type !== 'CategoryLabel'; }
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
  function selectComponent(qid) {
    selectedQuestionId = qid || null;
    scopeState = selectedQuestionId ? 'component' : 'section';
    selectedChoiceValue = null;
    applyCanvasDecoration();
    renderBreadcrumb();
    if (!selectedQuestionId && pendingInsert) { pendingInsert = null; updatePendingUi(); }
    populateInspector();
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
    populateInspector();
    renderInspectorMapping();
    setInspectorTab('choices');
    // populateInspector/setInspectorTab may have re-scoped — re-assert CHOICE.
    scopeState = 'choice';
    focusChoiceRow(value);
    renderScopeHeader();
    updateCanvasToolbar();
  }

  // --- inspector tabs (§7.3: DYNAMIC per selection — never a fixed strip) -------
  function availableTabsFor(node) {
    if (!node) { return []; }
    var meta = typeMeta(node.type);
    var tabs = [];
    // Content shows for a COPY-BEARING selection only (§7.3 "Shown when"): a
    // type with content props, or a §5.2 BOUND node (its shared text field).
    var hasContent = node.bind !== undefined || (meta.content_props || []).length > 0;
    // §5.4/§8.2: a legacy PAGE-FRAME element is not a unit component — it gets
    // its copy/structured props + Advanced, but no unit tabs (design/
    // validation/dependencies/mapping are unit-scope surfaces).
    if (meta.scope === 'frame') {
      if (hasContent) { tabs.push('content'); }
      if (meta.layout_props) { tabs.push('layout'); }
      tabs.push('advanced');
      return tabs;
    }
    if (hasContent) { tabs.push('content'); }
    if (meta.choice) { tabs.push('choices'); }
    // Structured-prop containers/leaves (Stack/Grid/…/TrustBar/LogoStrip)
    // author their token props on the Layout tab (wave-2 folds this into
    // Design depth per §7.3).
    if (meta.layout_props) { tabs.push('layout'); }
    // Design: any visual selection (§7.3) — containers included.
    tabs.push('design');
    if (meta.produces) { tabs.push('validation'); }
    if (meta.maps) { tabs.push('maps'); }
    tabs.push('dependencies');
    if (meta.produces) { tabs.push('mapping'); }
    tabs.push('advanced');
    return tabs;
  }
  function setInspectorTab(key) {
    // §7.5: opening the Advanced tab is tracked (admin-side, console-only —
    // no schema change).
    if (key === 'advanced' && currentInspectorTab !== 'advanced' && window.console && window.console.info) {
      window.console.info('section_advanced_opened', { section: state.public_id || 'new', component: selectedQuestionId });
    }
    // Leaving the Choices tab ends the choice scope (§7.2 retarget).
    if (key !== 'choices' && scopeState === 'choice') { scopeState = selectedQuestionId ? 'component' : 'section'; renderScopeHeader(); }
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
    return node.props ? node.props[field] : '';
  }
  function populateInspector() {
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
    else if (avail.indexOf(currentInspectorTab) === -1) { setInspectorTab(avail[0]); }
    else { setInspectorTab(currentInspectorTab); }

    // §5.2: a BOUND node's Content tab shows the SAME single shared field —
    // never a second text store. The generic props.text control is hidden for
    // it; the shared input mirrors the strip input (one store, two views).
    var boundWrap = document.querySelector('[data-bound-content]');
    var boundInput = document.querySelector('[data-bound-shared-input]');
    var boundLabel = document.querySelector('[data-bound-content-label]');
    if (boundWrap) { boundWrap.hidden = !isBound; }
    if (isBound && boundInput) {
      var boundStrip = stripInputFor(node.bind);
      boundInput.value = boundStrip ? boundStrip.value : '';
      if (boundLabel) {
        boundLabel.textContent = node.bind === 'section_subheadline'
          ? 'Subheadline (shared with the Section header above)'
          : 'Question headline (shared with the Section header above)';
      }
    }

    // content controls: only the selected type's copy fields are visible
    var wraps = document.querySelectorAll('[data-content-prop]');
    var cp = meta.content_props || [];
    var anyContent = isBound;
    for (i = 0; i < wraps.length; i++) {
      k = wraps[i].getAttribute('data-content-prop');
      var on = !!node && cp.indexOf(k) !== -1 && !(isBound && k === 'text');
      wraps[i].hidden = !on;
      if (on) { anyContent = true; }
    }
    var emptyNote = document.querySelector('[data-content-empty]');
    if (emptyNote) { emptyNote.hidden = anyContent || !node; }

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
    populateMapsPanel(node);
    populateConditional(node);
    populateRequiredWhen(node);
    populateDefaultControls(node);
    var groups = document.querySelectorAll('[data-container-group]');
    for (i = 0; i < groups.length; i++) {
      groups[i].hidden = !node || groups[i].getAttribute('data-container-group') !== node.type;
    }
    populateContainerProps(node);
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

  // --- §8.8 Maps panel: populate + collect (address/zip modes) -----------------
  function mapsControl(kind, key) {
    return document.querySelector('[data-maps-' + kind + '="' + key + '"]');
  }
  function populateMapsPanel(node) {
    var meta = node ? typeMeta(node.type) : {};
    var mode = meta.maps || null;
    var wraps = document.querySelectorAll('[data-maps-mode]');
    var i, m;
    for (i = 0; i < wraps.length; i++) {
      m = wraps[i].getAttribute('data-maps-mode');
      wraps[i].hidden = !mode || (m !== 'both' && m !== mode);
    }
    var zipNote = document.querySelector('[data-maps-zip-note]');
    if (zipNote) { zipNote.hidden = mode !== 'zip'; }
    if (!mode) { return; }
    var cfg = mapsConfigOf(node) || {};
    var flags = document.querySelectorAll('[data-maps-flag]');
    var k;
    for (i = 0; i < flags.length; i++) {
      k = flags[i].getAttribute('data-maps-flag');
      flags[i].checked = cfg[k] === true;
    }
    // Field pickers: THIS section's internal fields, excluding the component
    // itself (§8.8 — an autofill target is always ANOTHER question's field).
    var fields = internalFieldsOf();
    var fills = document.querySelectorAll('[data-maps-fill]');
    var sel, cur, opt, j;
    for (i = 0; i < fills.length; i++) {
      sel = fills[i];
      k = sel.getAttribute('data-maps-fill');
      cur = typeof cfg[k] === 'string' ? cfg[k] : '';
      clearChildren(sel);
      opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '\\u2014 none \\u2014';
      sel.appendChild(opt);
      for (j = 0; j < fields.length; j++) {
        if (node.internal_field && fields[j] === node.internal_field) { continue; }
        opt = document.createElement('option');
        opt.value = fields[j];
        opt.textContent = fields[j];
        sel.appendChild(opt);
      }
      // a saved target that left the tree still displays (never silently drop)
      var exists = false;
      for (j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === cur) { exists = true; break; }
      }
      if (cur !== '' && !exists) {
        opt = document.createElement('option');
        opt.value = cur;
        opt.textContent = cur + ' (missing from this Section)';
        sel.appendChild(opt);
      }
      sel.value = cur;
    }
  }
  // Build the §8.8 config object with the EXACT runtime keys for the mode.
  // Only switched-on keys are emitted (parseMapsConfig: absent = off). A ZIP
  // config with ANY feature on also carries enable_autocomplete — the
  // runtime's initMapsFields wires Places ONLY when autocomplete is enabled,
  // and §8.8 gives ZIP fields no separate autocomplete toggle.
  function buildMapsConfig(mode) {
    var cfg = {};
    var flagKeys = MAPS_FLAG_KEYS[mode] || [];
    var fillKeys = MAPS_FILL_KEYS[mode] || [];
    var i, el, v, any = false;
    for (i = 0; i < flagKeys.length; i++) {
      el = mapsControl('flag', flagKeys[i]);
      if (el && el.checked) { cfg[flagKeys[i]] = true; any = true; }
    }
    for (i = 0; i < fillKeys.length; i++) {
      el = mapsControl('fill', fillKeys[i]);
      v = el ? trimStr(el.value) : '';
      if (v !== '') { cfg[fillKeys[i]] = v; any = true; }
    }
    if (mode === 'zip' && any) { cfg.enable_autocomplete = true; }
    return cfg;
  }
  function collectMapsConfig() {
    var node = selectedNode();
    if (!node) { return; }
    var meta = typeMeta(node.type);
    if (!meta.maps) { return; }
    var cfg = buildMapsConfig(meta.maps);
    var empty = true, k;
    for (k in cfg) { if (Object.prototype.hasOwnProperty.call(cfg, k)) { empty = false; break; } }
    var props = ensureObj(node, 'props');
    // removing ALL config deletes props.maps — the node stays clean
    if (empty) { delete props.maps; } else { props.maps = cfg; }
    cleanupEmpty(node, 'props');
    applyCanvasDecoration();
    afterModelChange();
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
    var i;
    for (i = 0; i < fields.length; i++) {
      if (node && node.internal_field && fields[i] === node.internal_field) { continue; }
      opt = document.createElement('option');
      opt.value = fields[i];
      opt.textContent = fields[i];
      whenSel.appendChild(opt);
    }
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
    var i;
    for (i = 0; i < fields.length; i++) {
      if (node && node.internal_field && fields[i] === node.internal_field) { continue; }
      opt = document.createElement('option');
      opt.value = fields[i];
      opt.textContent = fields[i];
      whenSel.appendChild(opt);
    }
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
    var field = cond.when;
    var op = cond.op || 'eq';
    if (op === 'range') { return prefix + ' when ' + field + ' is between ' + String(cond.from) + ' and ' + String(cond.to); }
    if (op === 'in') { return prefix + ' when ' + field + ' is one of: ' + (cond.values || []).join(', '); }
    if (op === 'not_in') { return prefix + ' when ' + field + ' is none of: ' + (cond.values || []).join(', '); }
    var rel = 'is';
    if (op === 'neq') { rel = 'is not'; }
    else if (op === 'gt') { rel = 'is more than'; }
    else if (op === 'lt') { rel = 'is less than'; }
    else if (op === 'gte') { rel = 'is at least'; }
    else if (op === 'lte') { rel = 'is at most'; }
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
  var CHOICE_FIELD_PLACEHOLDERS = { analytics_id: 'Analytics label (auto)', imageMediaId: 'Image', image_alt: 'Image alt text', aria_label: 'Screen-reader label' };
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
  function buildChoiceRow(choice, isMain, node) {
    var wrap = document.createElement('div');
    wrap.className = 'lg-choice-row';
    wrap.setAttribute('data-choice-row', '');
    var i, inp, val;
    var inputsByField = {};
    for (i = 0; i < CHOICE_FIELDS.length; i++) {
      inp = document.createElement('input');
      inp.className = 'form-input';
      inp.setAttribute('data-choice-field', CHOICE_FIELDS[i]);
      inp.setAttribute('placeholder', CHOICE_FIELD_PLACEHOLDERS[CHOICE_FIELDS[i]] || CHOICE_FIELDS[i]);
      val = choice ? choice[CHOICE_FIELDS[i]] : undefined;
      inp.value = (val === undefined || val === null) ? '' : String(val);
      inp.addEventListener('input', collectChoices);
      inp.addEventListener('change', collectChoices);
      inputsByField[CHOICE_FIELDS[i]] = inp;
      wrap.appendChild(inp);
      // §5.5: the image cell is a PICKER cell — Choose… opens the shared
      // Media-library chooser writing into this input (same collect path).
      if (CHOICE_FIELDS[i] === 'imageMediaId') {
        wrap.appendChild(buildChoiceMediaButton(inp));
      }
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
    // §8.4: emoji ⊕ icon are mutually exclusive — setting one clears the other.
    var iconInput = inputsByField['icon'];
    var emojiInput = inputsByField['emoji'];
    if (iconInput && emojiInput) {
      iconInput.addEventListener('input', function () {
        if (trimStr(this.value) !== '' && trimStr(emojiInput.value) !== '') { emojiInput.value = ''; collectChoices(); }
      });
      emojiInput.addEventListener('input', function () {
        if (trimStr(this.value) !== '' && trimStr(iconInput.value) !== '') { iconInput.value = ''; collectChoices(); }
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
  function buildChoiceMediaButton(input) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-sm btn-outline';
    b.setAttribute('data-choice-media-choose', '');
    b.textContent = 'Choose\\u2026';
    b.addEventListener('click', function () {
      openMediaPicker({ input: input, onpick: collectChoices });
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
      o.textContent = 'Custom color (legacy)';
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
      legacyEl = document.querySelector('[data-override-legacy="' + key + '"]');
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

  // --- §5.4 Move to Quote frame: the LIVE action ---------------------------------
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
      showMoveNote('Moved into the Quote frame of “' + funnel.name + '”. Save the Section to persist the removal.');
      return;
    }
    fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ content_json: JSON.stringify(state.content) })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, body: j }; });
    }).then(function (res) {
      if (!res.ok) {
        showRefusal('The element moved into the frame, but saving its removal failed: ' + ((res.body && res.body.error) || 'error') + ' — Save the Section to persist it.');
        return;
      }
      if (!wasDirty) { dirty = false; }
      showMoveNote('Moved into the Quote frame of “' + funnel.name + '” — the Section was saved without the element.');
    }).catch(function () {
      showRefusal('The element moved into the frame, but saving its removal failed — Save the Section to persist it.');
    });
  }
  function doMoveToFrame(qid, funnel) {
    var ref = findRef(qid);
    if (!ref) { return; }
    // §5.4: explicit confirm that NAMES the funnel, before any write.
    if (!window.confirm(moveConfirmMessage(ref.node, funnel.name))) { return; }
    var group = equivalentFrameGroup(ref.node);
    if (group === null) {
      showRefusal('This element has no Quote-frame equivalent — configure it in the Quote Builder instead.');
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
        showRefusal('Could not read the funnel frame — the element stays in this Section.');
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
          showRefusal('Frame save failed: ' + ((putRes.body && putRes.body.error) || 'error') + ' — the element stays in this Section.');
          return;
        }
        finishMoveToFrame(qid, funnel, wasDirty);
      });
    }).catch(function () {
      showRefusal('Frame save failed — the element stays in this Section.');
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
    var badge = document.querySelector('[data-frame-badge="' + qid + '"]');
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
      showRefusal('This Section isn’t used by any funnel yet — there is no Quote frame to move this element into. Configure the frame in the Quote Builder.');
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
  function addFromLibrary(type) {
    var node = null;
    if (pendingInsert) {
      node = insertRelative(pendingInsert.qid, pendingInsert.where, type);
      pendingInsert = null;
      updatePendingUi();
    } else {
      var sel = selectedNode();
      if (sel && isContainerType(sel.type)) { node = addComponentAt(type, sel.question_id, null); }
      else { node = addComponentAt(type, null, null); }
    }
    if (node) { selectComponent(node.question_id); }
  }
  var libraryEl = document.querySelector('[data-studio-library]');
  if (libraryEl) {
    libraryEl.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn) { return; }
      // §5.2: a disabled bound item never consumes the armed insertion point.
      if (btn.getAttribute('data-bind-disabled') === 'true') { return; }
      addFromLibrary(btn.getAttribute('data-add-component'));
    });
    // the items are role="button" divs (nested-button validity) — keep the
    // native keyboard activation contract.
    libraryEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn) { return; }
      ev.preventDefault();
      if (btn.getAttribute('data-bind-disabled') === 'true') { return; }
      addFromLibrary(btn.getAttribute('data-add-component'));
    });
    libraryEl.addEventListener('dragstart', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn || !ev.dataTransfer) { return; }
      ev.dataTransfer.setData('text/plain', 'add:' + btn.getAttribute('data-add-component'));
    });
    var search = libraryEl.querySelector('[data-studio-library-search]');
    if (search) {
      search.addEventListener('input', function () {
        var q = trimStr(this.value).toLowerCase();
        var items = libraryEl.querySelectorAll('[data-add-component]');
        var i, text;
        for (i = 0; i < items.length; i++) {
          text = items[i].getAttribute('data-search-text') || '';
          items[i].setAttribute('data-search-hidden', q !== '' && text.indexOf(q) === -1 ? 'true' : 'false');
        }
      });
    }
  }

  // --- canvas events: select / drag-drop / keyboard reorder -----------------------
  var dropHint = null;
  var canvasSurface = document.getElementById('lg-studio-canvas');
  if (canvasSurface) {
    canvasSurface.addEventListener('click', function (ev) {
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
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!el || !canvasSurface.contains(el)) { return; }
      ev.preventDefault();
      // §6.2/§6.4: clicking a card/button selects the CHOICE, not just the
      // component (the inspector opens the Choices tab at that row).
      var cardEl = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
      if (cardEl && el.contains(cardEl) && typeMeta(el.getAttribute('data-component-type')).choice === true) {
        selectChoice(el.getAttribute('data-question-id'), cardEl.getAttribute('data-lg-choice'));
        return;
      }
      selectComponent(el.getAttribute('data-question-id'));
    });
    // §6.2 inline text editing on double-click: bound/label/helper text writes
    // the bound column or props; a choice card edits its label.
    canvasSurface.addEventListener('dblclick', function (ev) {
      var host = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!host || !canvasSurface.contains(host)) { return; }
      var qid = host.getAttribute('data-question-id');
      var ref = findRef(qid);
      if (!ref) { return; }
      ev.preventDefault();
      var cardEl = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
      var editEl, committer;
      if (cardEl && typeMeta(ref.node.type).choice === true) {
        var choiceValue = cardEl.getAttribute('data-lg-choice');
        editEl = cardEl.querySelector('.lg-card-title') || cardEl;
        committer = function (text) { commitInlineChoiceLabel(qid, choiceValue, text); };
      } else {
        var key = inlineEditKeyFor(ref.node);
        if (key === null) { return; }
        editEl = host;
        committer = function (text) { commitInlineText(qid, key, text); };
      }
      startInlineEdit(editEl, committer);
    });
    // §6.2 container resize handles snap to the width presets only.
    canvasSurface.addEventListener('mousedown', function (ev) {
      var handle = ev.target && ev.target.closest ? ev.target.closest('[data-resize-handle]') : null;
      if (!handle) { return; }
      ev.preventDefault();
      var qid = handle.getAttribute('data-resize-handle');
      var startX = ev.clientX;
      function onUp(upEv) {
        document.removeEventListener('mouseup', onUp);
        var ref = findRef(qid);
        if (!ref) { return; }
        var props = ensureObj(ref.node, 'props');
        var next = snapWidthPreset(typeof props.width === 'string' ? props.width : 'm', upEv.clientX - startX);
        if (next !== props.width) { props.width = next; afterModelChange(); }
      }
      document.addEventListener('mouseup', onUp);
    });
    canvasSurface.addEventListener('dragstart', function (ev) {
      // §6.2: dragging a CHOICE card reorders choices within its component.
      var cardEl = ev.target && ev.target.closest ? ev.target.closest('[data-lg-choice]') : null;
      if (cardEl && ev.dataTransfer) {
        var cardHost = cardEl.closest ? cardEl.closest('[data-question-id]') : null;
        if (cardHost && typeMeta(cardHost.getAttribute('data-component-type')).choice === true) {
          ev.dataTransfer.setData('text/plain', 'choice:' + cardHost.getAttribute('data-question-id') + ':' + cardEl.getAttribute('data-lg-choice'));
          return;
        }
      }
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!el || !ev.dataTransfer) { return; }
      ev.dataTransfer.setData('text/plain', 'move:' + el.getAttribute('data-question-id'));
    });
    canvasSurface.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      clearDropClasses();
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!el || !canvasSurface.contains(el)) { dropHint = { qid: null, mode: 'append' }; return; }
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
    });
    canvasSurface.addEventListener('drop', function (ev) {
      ev.preventDefault();
      clearDropClasses();
      var data = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
      var hint = dropHint || { qid: null, mode: 'append' };
      dropHint = null;
      if (!data || data.indexOf(':') === -1) { return; }
      var kind = data.slice(0, data.indexOf(':'));
      var payload = data.slice(data.indexOf(':') + 1);
      var placed = null;
      var ref;
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
        if (hint.mode === 'into') { placed = addComponentAt(payload, hint.qid, null); }
        else if (hint.mode === 'before' || hint.mode === 'after') { placed = insertRelative(hint.qid, hint.mode, payload); }
        else { placed = addComponentAt(payload, null, null); }
        if (placed) { selectComponent(placed.question_id); }
      } else if (kind === 'move') {
        if (payload === hint.qid) { return; }
        if (hint.mode === 'into') { moveNodeTo(payload, hint.qid, null); }
        else if (hint.mode === 'before' || hint.mode === 'after') {
          ref = findRef(hint.qid);
          if (ref) { moveNodeTo(payload, ref.parent ? ref.parent.question_id : null, ref.index + (hint.mode === 'after' ? 1 : 0)); }
        } else { moveNodeTo(payload, null, null); }
        selectComponent(payload);
      }
    });
    canvasSurface.addEventListener('keydown', function (ev) {
      if (!selectedQuestionId) { return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); moveWithin(selectedQuestionId, -1); }
      else if (ev.key === 'ArrowDown') { ev.preventDefault(); moveWithin(selectedQuestionId, 1); }
      // §6.2: Del deletes the selection; Esc walks UP the ancestry.
      else if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        removeNode(selectedQuestionId);
        selectComponent(null);
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        var upRef = findRef(selectedQuestionId);
        selectComponent(upRef && upRef.parent ? upRef.parent.question_id : null);
      }
    });
  }

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
      setInspectorTab('choices');
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
      // §6.4 choice cluster acts.
      var choiceBtn = ev.target && ev.target.closest ? ev.target.closest('[data-choice-act]') : null;
      if (choiceBtn) { handleChoiceAct(choiceBtn.getAttribute('data-choice-act')); return; }
      var chipBtn = ev.target && ev.target.closest ? ev.target.closest('[data-choice-value-chip]') : null;
      if (chipBtn && selectedChoiceValue !== null) {
        setInspectorTab('choices');
        focusChoiceRow(String(selectedChoiceValue));
        return;
      }
      // §6.5 component-cluster quick controls.
      var addChoiceBtn = ev.target && ev.target.closest ? ev.target.closest('[data-toolbar-add-choice]') : null;
      if (addChoiceBtn) {
        var acNode = selectedNode();
        var acAdded = acNode ? addChoiceToNode(acNode) : null;
        if (acAdded) { selectChoice(acNode.question_id, String(acAdded.value)); }
        return;
      }
      var autoBtn = ev.target && ev.target.closest ? ev.target.closest('[data-toolbar-autoadvance]') : null;
      if (autoBtn) {
        // reflects + toggles the Section continue mode (§5.5) — writes the
        // SAME store the Question-strip radios own.
        state.continue_mode = (state.continue_mode || 'button') === 'auto_advance' ? 'button' : 'auto_advance';
        var radios = document.querySelectorAll('input[name="continue_mode"]');
        var ri;
        for (ri = 0; ri < radios.length; ri++) { radios[ri].checked = radios[ri].value === state.continue_mode; }
        markDirty();
        updateCanvasToolbar();
        return;
      }
      var valShortcut = ev.target && ev.target.closest ? ev.target.closest('[data-toolbar-open-validation]') : null;
      if (valShortcut) { setInspectorTab('validation'); return; }
      var searchToggle = ev.target && ev.target.closest ? ev.target.closest('[data-toolbar-searchable]') : null;
      if (searchToggle) {
        var sNode = selectedNode();
        if (sNode) { toggleSearchableDropdown(sNode); }
        return;
      }
      // §6.6 preset menu.
      var presetSaveBtn = ev.target && ev.target.closest ? ev.target.closest('[data-preset-save]') : null;
      if (presetSaveBtn) { savePresetFromSelection(); return; }
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
      else if (act === 'delete') { removeNode(selectedQuestionId); selectComponent(null); }
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
  var canvasViewportBtns = document.querySelectorAll('[data-canvas-viewport]');
  var cvb;
  for (cvb = 0; cvb < canvasViewportBtns.length; cvb++) {
    canvasViewportBtns[cvb].addEventListener('click', function () {
      canvasViewport = this.getAttribute('data-canvas-viewport') === 'mobile' ? 'mobile' : 'desktop';
      var all = document.querySelectorAll('[data-canvas-viewport]');
      var k;
      for (k = 0; k < all.length; k++) {
        var isOn = all[k] === this;
        all[k].className = isOn ? 'btn btn-sm btn-secondary active' : 'btn btn-sm btn-secondary';
        all[k].setAttribute('aria-pressed', isOn ? 'true' : 'false');
      }
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
    var i, k;
    for (i = 0; i < tabs.length; i++) {
      k = tabs[i].getAttribute('data-studio-drawer-tab');
      tabs[i].className = k === key ? 'studio-tab active' : 'studio-tab';
      tabs[i].setAttribute('aria-selected', k === key ? 'true' : 'false');
    }
    for (i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-studio-drawer-panel') !== key;
    }
  }
  var drawerTabs = document.querySelectorAll('[data-studio-drawer-tab]');
  var dt;
  for (dt = 0; dt < drawerTabs.length; dt++) {
    drawerTabs[dt].addEventListener('click', function () {
      setDrawerTab(this.getAttribute('data-studio-drawer-tab'));
    });
  }
  var chipEl = document.querySelector('[data-studio-validation-chip]');
  if (chipEl) { chipEl.addEventListener('click', function () { setDrawerTab('validation'); }); }
  var openMapping = document.querySelector('[data-studio-open-mapping-drawer]');
  if (openMapping) { openMapping.addEventListener('click', function () { setDrawerTab('mapping'); }); }
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
  // §8.8 Maps controls: every toggle/picker change re-collects the whole
  // config for the selected node's mode (exact-keys emission).
  var mapsEls = document.querySelectorAll('[data-maps-flag], [data-maps-fill]');
  var me;
  for (me = 0; me < mapsEls.length; me++) {
    mapsEls[me].addEventListener('change', collectMapsConfig);
  }
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

  function sampleAnswers() {
    var el = document.getElementById('lg-dependency-answers');
    if (!el) { return {}; }
    var t = trimStr(el.value);
    if (t === '') { return {}; }
    try { var parsed = JSON.parse(t); return (parsed && typeof parsed === 'object') ? parsed : {}; } catch (e) { return {}; }
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
    // §5.3 mode 5: a picked Quote frame rides the LANDED frame_context param —
    // the unit renders inside that funnel's effective frame (13 §13.4).
    var frameCtx = frameContextBody();
    if (frameCtx !== null) { requestBody.frame_context = frameCtx; }
    var designSel = document.getElementById('lg-preview-design');
    if (designSel && trimStr(designSel.value) !== '') { requestBody.design_id = trimStr(designSel.value); }
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
  function populateOptionSelect(sel, items, current) {
    if (!sel) { return; }
    clearChildren(sel);
    var values = items.slice();
    if (current !== '' && values.indexOf(current) === -1) { values.unshift(current); }
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '\\u2014 pick \\u2014';
    sel.appendChild(blank);
    var i, o;
    for (i = 0; i < values.length; i++) {
      o = document.createElement('option');
      o.value = values[i];
      o.textContent = values[i];
      sel.appendChild(o);
    }
    sel.value = current;
  }
  var activitySel = document.getElementById('lg-section-activity');
  var verticalSel = document.getElementById('lg-section-vertical');
  function loadActivities() {
    if (!activitySel) { return; }
    fetchItems('/api/admin/leadgen/activities', function (items) {
      populateOptionSelect(activitySel, items, activitySel.value);
    });
  }
  function loadVerticals() {
    if (!verticalSel) { return; }
    var activity = activitySel ? trimStr(activitySel.value) : '';
    var url = '/api/admin/leadgen/verticals' + (activity === '' ? '' : '?activity=' + encodeURIComponent(activity));
    fetchItems(url, function (items) {
      populateOptionSelect(verticalSel, items, verticalSel.value);
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
    markDirty();
    if (after) { after(v); }
  }
  var newActivityBtn = document.querySelector('[data-studio-new-activity]');
  if (newActivityBtn) {
    newActivityBtn.addEventListener('click', function () {
      promptNewSharedValue('activity', activitySel, function () {
        if (verticalSel) { verticalSel.value = ''; }
        loadVerticals();
      });
    });
  }
  var newVerticalBtn = document.querySelector('[data-studio-new-vertical]');
  if (newVerticalBtn) {
    newVerticalBtn.addEventListener('click', function () {
      promptNewSharedValue('vertical', verticalSel);
    });
  }
  if (activitySel) {
    // §8.2: changing Activity RESETS Vertical (the vertical list is derived
    // from the selected activity).
    activitySel.addEventListener('change', function () {
      if (verticalSel) { verticalSel.value = ''; }
      loadVerticals();
      renderOffersStaleNote();
    });
  }
  if (verticalSel) { verticalSel.addEventListener('change', renderOffersStaleNote); }

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
  function updateMappingBadge() {
    var badge = document.querySelector('[data-studio-mapping-badge]');
    if (!badge || !offersData) { return; }
    var list = offersList();
    var total = 0, complete = 0, i, live;
    for (i = 0; i < list.length; i++) {
      live = offerLiveState(list[i]);
      if (live.state === 'not_selected') { continue; }
      total += 1;
      if (live.state === 'complete') { complete += 1; }
    }
    badge.textContent = 'Mapping ' + complete + '/' + total + ' Offers complete';
    badge.setAttribute('data-mapping-complete', String(complete));
    badge.setAttribute('data-mapping-total', String(total));
    badge.setAttribute('data-publishable', complete === total ? 'true' : 'false');
    badge.className = 'studio-chip studio-chip-mapping badge ' + (complete === total ? 'badge-published' : 'badge-archived');
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
    // §12.3: the canvas overlay chips derive from the SAME live model — every
    // mapping edit repaints them (decoration is rebuild-per-pass idempotent).
    applyCanvasDecoration();
  }
  function loadOffers() {
    if (!state.public_id) {
      offersNote('Save the Section first \\u2014 the Available Offers panel derives from the SAVED Activity/Vertical pair (\\u00A78.2).');
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
  // Advanced-tab input) — the place the answer identity is authored.
  function openFixTypeSurface(internalField) {
    var node = questionByField(internalField);
    if (!node) { return false; }
    selectComponent(node.question_id);
    setInspectorTab('advanced');
    var inp = document.getElementById('lg-inspector-internal-field');
    if (inp && inp.focus) { inp.focus(); }
    return true;
  }
  // "Re-link…" → the component's quick-map on the inspector Mapping tab
  // (picking a field there drops the stale edge for this Offer + component
  // and upserts the new one); a component-less edge falls back to the
  // Map-fields editor.
  function openFixRelink(offer, internalField, path) {
    var node = trimStr(internalField) === '' ? null : questionByField(internalField);
    if (!node) { openFixMapGrid(offer, path); return; }
    selectComponent(node.question_id);
    setInspectorTab('mapping');
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

  // --- §5.2 binding wiring: strip ⇄ bound-node views of the ONE store ----------
  // The strip inputs ARE the store (headline_text/subheadline_text). The
  // inspector's shared field and the canvas render are the other views.
  function collectBoundShared() {
    var node = selectedNode();
    if (!node || node.bind === undefined) { return; }
    var inputEl = document.querySelector('[data-bound-shared-input]');
    var strip = stripInputFor(node.bind);
    if (!inputEl || !strip) { return; }
    strip.value = inputEl.value;
    markDirty();
    scheduleCanvasRender();
  }
  var boundSharedInput = document.querySelector('[data-bound-shared-input]');
  if (boundSharedInput) {
    boundSharedInput.addEventListener('input', collectBoundShared);
    boundSharedInput.addEventListener('change', collectBoundShared);
  }
  // Typing in the strip live-updates the canvas render (bound nodes) and the
  // inspector mirror when a bound node is selected.
  function onStripInput() {
    var node = selectedNode();
    if (node && node.bind !== undefined && boundSharedInput) {
      var strip = stripInputFor(node.bind);
      if (strip && boundSharedInput.value !== strip.value) { boundSharedInput.value = strip.value; }
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
        setInspectorTab('choices');
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

  // --- scalar controls (continue mode + Maps toggle) --------------------------------------
  var mapsToggle = document.getElementById('lg-address-validation');
  if (mapsToggle) {
    mapsToggle.addEventListener('change', function () {
      state.address_validation_enabled = this.checked;
      markDirty();
    });
  }
  var continueRadios = document.querySelectorAll('input[name="continue_mode"]');
  var ci;
  for (ci = 0; ci < continueRadios.length; ci++) {
    continueRadios[ci].addEventListener('change', function () {
      if (this.checked) { state.continue_mode = this.value; markDirty(); }
    });
  }

  // --- Save (POST create / PATCH update) — the UNCHANGED old-island body shape ------------
  function collectSection() {
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
    }
  }
  var saveBtn = document.getElementById('lg-section-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var errEl = document.getElementById('lg-section-error');
      if (errEl) { errEl.hidden = true; }
      renderSaveProblems([]);
      renderZeroOffersWarning();
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
          // FIX 5: server-side FIELD errors route inline where a control
          // matches (400 body: { error, fields }).
          routeSaveFieldErrors(res.body && res.body.fields);
          return;
        }
        dirty = false;
        // §6.1.3: the history is per open editor and cleared on Save.
        historyReset();
        // FIX 5: the save landed — non-blocking problems[] surface as the
        // summary + click-to-focus rows. An EXISTING Section stays on the
        // page so the rows are readable; a NEW Section must still navigate
        // to its minted URL.
        var problems = (res.body && res.body.problems) ? res.body.problems : [];
        if (!isNew && problems.length > 0) {
          renderSaveProblems(problems);
          return;
        }
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
      if (!window.confirm('Archive this Section? It can be reactivated later.')) { return; }
      fetch('/api/admin/leadgen/sections/' + encodeURIComponent(state.public_id), {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function () { dirty = false; window.location.href = '/admin/leadgen/sections'; });
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
  updatePendingUi();
  renderIssues();
  renderMapsBanner();
  renderBoundChips();
  updatePaletteBindItems();
  renderBindBanner();
  renderScopeHeader();
  updateCanvasEmpty();
  applyCanvasDecoration();
  populateInspector();
  renderBreadcrumb();
  updateCanvasToolbar();
  populateSectionOverrides();
  loadComponentPresets();
  loadFramePickerQuotes();
  loadActivities();
  loadVerticals();
  loadOffers();
  loadUsage();
  // R5 fix-link integration: /admin/leadgen/sections/:id/edit#mapping (the
  // quote activation preflight's "Open Section Mapping" link) opens the
  // mapping drawer tab directly.
  if (window.location.hash === '#mapping') { setDrawerTab('mapping'); }
  runPreview();
}());
`;
