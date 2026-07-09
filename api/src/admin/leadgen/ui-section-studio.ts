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

// Every catalog type appears in EXACTLY ONE group (lockstep-guarded by the
// studio test). HeaderLogo and DisclosureLink are not named in the §8.3 lists;
// they stay placeable under Layout / Trust & affordance respectively.
export const STUDIO_LIBRARY_GROUPS: readonly StudioGroup[] = [
  { key: "questions", label: "Questions", types: ["CategoryLabel", "QuestionHeadline", "Subheadline", "HelperText"] },
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
    label: "Layout",
    types: ["CardPanel", "Stack", "GridContainer", "Columns", "Spacer", "HeaderBar", "FooterBar", "BackgroundPanel", "HeaderLogo"],
  },
  {
    key: "trust",
    label: "Trust & affordance",
    types: ["ReassuranceBadge", "SecureFormBadge", "TrustBar", "LogoStrip", "LegalNote", "ValidationError", "SuccessState", "DisclosureLink"],
  },
  {
    key: "navigation",
    label: "Navigation",
    types: ["ContinueButton", "AutoAdvanceButton", "BackButton", "ProgressBar", "StepIndicator"],
  },
];

// §8.3 plain name + one-line description per placeable type.
const STUDIO_TYPE_META: Record<ComponentType, { label: string; description: string }> = {
  ProgressBar: { label: "Progress bar", description: "Step or percent progress across the funnel." },
  HeaderLogo: { label: "Header logo", description: "Brand logo slot for the funnel header." },
  BackButton: { label: "Back / Previous", description: "Returns the visitor to the previous slide." },
  DisclosureLink: { label: "Disclosure link", description: "Expandable legal / advertiser disclosure." },
  StepIndicator: { label: "Step indicator", description: "Multi-step dot indicator with current step." },
  CategoryLabel: { label: "Category label", description: "Uppercase kicker above the question headline." },
  QuestionHeadline: { label: "Question headline", description: "The main question copy of the slide." },
  Subheadline: { label: "Subheadline", description: "Supporting copy under the headline." },
  HelperText: { label: "Helper text", description: "Small reassurance / hint line near a field." },
  RangeQuestion: { label: "Range slider", description: "Numeric slider between min and max." },
  CurrencyRangeQuestion: { label: "Currency range", description: "Currency-formatted slider (loan amounts)." },
  NumberRangeQuestion: { label: "Number range", description: "Plain numeric slider variant." },
  ButtonAnswerGroup: { label: "Button answer group", description: "One-tap answer buttons, one choice stored." },
  TwoButtonYesNo: { label: "Two-button yes/no", description: "Yes / No pair storing a boolean answer." },
  IconCardAnswerGrid: { label: "Icon card grid", description: "Icon cards in a responsive answer grid." },
  ImageCardAnswerGrid: { label: "Image card grid", description: "Image cards (brand/carrier pickers)." },
  MultiChoiceCardGroup: { label: "Multi-choice card group", description: "Select several cards (min/max bounded)." },
  DropdownQuestion: { label: "Dropdown", description: "Single-select dropdown of choices." },
  SearchableDropdownQuestion: { label: "Searchable dropdown", description: "Dropdown with a client-side search box." },
  OtherGroupSelector: { label: "Other-group selector", description: "Main choices as buttons plus an Other panel." },
  FreeTextQuestion: { label: "Free text", description: "Single-line free text input." },
  NumberInputQuestion: { label: "Number input", description: "Plain numeric input (not a slider)." },
  CurrencyInputQuestion: { label: "Currency input", description: "Currency-prefixed plain input." },
  EmailInputQuestion: { label: "Email", description: "Email input with format validation." },
  PhoneInputQuestion: { label: "Phone", description: "Phone input with format validation." },
  NameFieldsGroup: { label: "Name fields", description: "First + last name field pair." },
  DateQuestion: { label: "Date input", description: "Date input with an allowed range." },
  ZIPInputQuestion: { label: "ZIP", description: "5-digit ZIP input (Maps validation optional)." },
  AddressAutocompleteQuestion: { label: "Address autocomplete", description: "Street address with Places autocomplete." },
  ContinueButton: { label: "Continue button", description: "Validates the slide, then continues." },
  AutoAdvanceButton: { label: "Auto-advance", description: "Advances immediately on answer click." },
  ReassuranceBadge: { label: "Reassurance badge", description: "Icon + copy trust line under the answers." },
  SuccessState: { label: "Success state", description: "Completion panel with heading + message." },
  SecureFormBadge: { label: "Secure form badge", description: "Lock badge naming the form security." },
  TrustBar: { label: "Trust bar", description: "Icon/text trust pairs, horizontal or stacked." },
  LogoStrip: { label: "Logo strip", description: "Carrier / partner logo row." },
  ValidationError: { label: "Validation error", description: "Inline error slot for a field." },
  LegalNote: { label: "Legal note", description: "Small-print legal copy block." },
  Stack: { label: "Stack", description: "Vertical/horizontal token-gap grouping." },
  GridContainer: { label: "Grid", description: "Per-breakpoint column grid container." },
  Columns: { label: "Columns", description: "Two-column ratio preset with mobile stacking." },
  CardPanel: { label: "Card panel", description: "The centered question card container." },
  BackgroundPanel: { label: "Background panel", description: "Full-background section with token fill." },
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
const SAMPLE_IMAGE_CHOICES = SAMPLE_CHOICES.map((c) => ({ ...c, imageMediaId: "media_sample" }));

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

// The two studio bootstrap blobs: the legacy-shaped seed templates + the new
// studio metadata (max depth rides along so the island never hardcodes it).
export function renderStudioSeedData(): string {
  return (
    jsonBlob("lg-component-seeds", componentSeedTemplates()) +
    jsonBlob("lg-studio-meta", { max_depth: LEADGEN_MAX_CONTAINER_DEPTH, types: studioTypeMeta() })
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

// The scalar fields the save path needs beyond the top bar (§12.5 continue
// mode, §12.8/§30.2 Maps toggle, headline/subheadline columns). Same element
// ids as the old editor so collectSection + the dirty watcher are unchanged.
export function renderStudioSettings(view: StudioSectionView, mapsKeyConfigured: boolean): string {
  const mapsKeyNote = mapsKeyConfigured
    ? `<span class="lg-maps-note" data-maps-key="configured">Maps key configured (operator-owned browser key) — autofill available.</span>`
    : `<span class="lg-maps-note" data-maps-key="absent">Maps key not configured — autofill disabled (§30.2 no-op).</span>`;
  return `<form id="lg-section-form" class="studio-settings" data-studio-settings novalidate>
  <div class="form-group">
    <label class="form-label" for="lg-section-headline">Headline (the question) *</label>
    <input id="lg-section-headline" name="headline_text" class="form-input" required aria-required="true" value="${escapeHtml(view.headline_text)}" />
  </div>
  <div class="form-group">
    <label class="form-label" for="lg-section-subheadline">Subheadline</label>
    <input id="lg-section-subheadline" name="subheadline_text" class="form-input" value="${escapeHtml(view.subheadline_text ?? "")}" />
  </div>
  <fieldset class="form-group">
    <legend class="form-label">Continue mode (§12.5)</legend>
    <label class="lg-check"><input type="radio" name="continue_mode" value="button"${view.continue_mode === "button" ? " checked" : ""} /> Button (validate, then Continue)</label>
    <label class="lg-check"><input type="radio" name="continue_mode" value="auto_advance"${view.continue_mode === "auto_advance" ? " checked" : ""} /> Auto-advance (navigate on click)</label>
  </fieldset>
  <div class="form-group">
    <label class="lg-check"><input type="checkbox" id="lg-address-validation" name="address_validation_enabled"${view.address_validation_enabled ? " checked" : ""} /> Google-Maps address / ZIP validation (§12.8)</label>
    <span class="lg-maps-note" data-maps-legacy-note>Legacy GLOBAL toggle (column kept for compat) — per-field Maps config on an Address/ZIP component (Inspector &#8594; Maps tab) WINS over it when present (§8.8).</span>
    <span class="lg-maps-note">The Maps key is a wrangler secret (GOOGLE_MAPS_BROWSER_KEY) — never embedded in cached HTML. Absent key &#8658; the validation leg no-ops.</span>
    ${mapsKeyNote}
  </div>
</form>`;
}

// ---------------------------------------------------------------------------
// §8.3 component library (left rail)
// ---------------------------------------------------------------------------

function renderLibraryItem(type: ComponentType, design: FunnelDesign): string {
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
  const answerType = produces === null ? "" : `<span class="studio-item-type">${escapeHtml(String(produces))}</span>`;
  const mapsBadge = produces === null ? "" : `<span class="studio-item-maps" data-maps-badge>maps to Offer fields</span>`;
  return `<div class="studio-library-item" role="button" tabindex="0" draggable="true" data-add-component="${escapeHtml(type)}" data-search-text="${escapeHtml(`${meta.label} ${meta.description}`.toLowerCase())}" aria-label="Add ${escapeHtml(meta.label)}">
  <span class="studio-thumb" aria-hidden="true"><span class="studio-thumb-scale" data-funnel-design="${escapeHtml(design.id)}">${thumbHtml}</span></span>
  <span class="studio-item-body">
    <span class="studio-item-name">${escapeHtml(meta.label)}</span>
    <span class="studio-item-desc">${escapeHtml(meta.description)}</span>
    <span class="studio-item-meta">${answerType}${mapsBadge}</span>
  </span>
</div>`;
}

export function renderStudioLibrary(design: FunnelDesign): string {
  const groups = STUDIO_LIBRARY_GROUPS.map((group) => {
    const items = group.types.map((t) => renderLibraryItem(t, design)).join("");
    return `<div class="studio-library-group" data-library-group="${escapeHtml(group.key)}">
  <h4 class="studio-library-heading">${escapeHtml(group.label)}</h4>
  <div class="studio-library-items">${items}</div>
</div>`;
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
export function studioCanvasDocument(content: LeadgenSectionContent, design: FunnelDesign): string {
  const nodes = (Array.isArray(content.components) ? content.components : []).filter(
    (n): n is LeadgenComponentNode => typeof n === "object" && n !== null && typeof (n as { type?: unknown }).type === "string",
  );
  const rendered = renderSectionComponents(nodes, design);
  const css = funnelChromeCss(design, `[${FUNNEL_DESIGN_SCOPE_ATTR}="${design.id}"]`);
  return (
    `<style>${css}</style>` +
    `<div data-funnel-design="${design.id}" data-viewport="desktop" class="lg-preview lg-preview-desktop" style="max-width:${design.header.contentMaxWidth};margin:0 auto"><div class="lg-content">${rendered}</div></div>`
  );
}

export function renderStudioCanvas(content: LeadgenSectionContent, design: FunnelDesign): string {
  const empty = !Array.isArray(content.components) || content.components.length === 0;
  return `<div class="studio-canvas" data-studio-canvas>
  <div class="studio-canvas-head">
    <h3 class="card-title">Canvas</h3>
    <div class="studio-breadcrumb" data-studio-breadcrumb aria-live="polite"></div>
  </div>
  <div class="studio-toolbar" data-studio-selection-toolbar hidden>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="move-up" aria-label="Move up">&#8593;</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="move-down" aria-label="Move down">&#8595;</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="add-before" aria-pressed="false">+ Before</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="add-after" aria-pressed="false">+ After</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="duplicate">Duplicate</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="group-stack">Group &#8594; Stack</button>
    <button type="button" class="btn btn-sm btn-outline" data-studio-act="group-cardpanel">Group &#8594; CardPanel</button>
    <button type="button" class="btn btn-sm btn-danger" data-studio-act="delete">Delete</button>
  </div>
  <p class="studio-pending-note" data-studio-pending-note hidden role="status" aria-live="polite"></p>
  <p class="studio-refusal alert alert-error" data-studio-drop-refusal hidden role="status" aria-live="polite"></p>
  <div class="studio-canvas-surface" id="lg-studio-canvas" tabindex="0" aria-label="Section canvas — click a component to select; arrow keys reorder">
    <div class="studio-canvas-render" id="lg-studio-canvas-render">${studioCanvasDocument(content, design)}</div>
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
    mobileBehavior: [
      { value: "stack", label: "stack" },
      { value: "keep", label: "keep" },
    ],
  };
}

const TOKEN_CONTROL_LABELS: Record<string, string> = {
  iconColor: "Icon color token",
  columns: "Card columns (2–5)",
  featureColor: "Feature color token",
  rangeColor: "Range fill token",
  buttonBackground: "Button background token",
  buttonText: "Button text token",
  gridGap: "Answer-grid gap token",
  mobileBehavior: "Mobile behavior",
};

function renderDesignPanel(design: FunnelDesign): string {
  const tokenOptions = curatedTokenOptions(design);
  const curated: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);
  const selects = Object.keys(TOKEN_CONTROL_LABELS)
    .filter((key) => curated.has(key))
    .map((key) => {
      const opts = (tokenOptions[key] ?? [])
        .map((o) => `<option value="${escapeHtml(o.value)}">${escapeHtml(`${o.label} (${o.value})`)}</option>`)
        .join("");
      return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="lg-inspector-${escapeHtml(key)}">${escapeHtml(TOKEN_CONTROL_LABELS[key])}</label>
  <select id="lg-inspector-${escapeHtml(key)}" class="form-input" data-inspector-override="${escapeHtml(key)}"><option value="">inherit</option>${opts}</select>
</div>`;
    })
    .join("");
  return `<div class="form-group lg-inspector-field">
  <label class="form-label" for="lg-inspector-preset">Component style preset</label>
  <input id="lg-inspector-preset" class="form-input" type="text" data-inspector-field="design_preset" placeholder="preset name" />
</div>
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

// The full tabbed inspector. Panels are server-rendered ONCE; the island
// toggles tab/panel visibility per the selected node's type metadata and
// populates/collects values (data-inspector-field / data-inspector-override /
// data-inspector-cond / data-choice-field / data-container-prop hooks).
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
  <div class="lg-inspector-head"><h3 class="card-title">Inspector</h3><span class="form-help" id="lg-inspector-target">Select a component</span></div>
  <div class="studio-tabs" role="tablist" aria-label="Inspector tabs">${tabButtons}</div>

  <div class="studio-panel" data-studio-panel="content" role="tabpanel">
    ${contentInputs}
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
      <label class="form-label" for="lg-choice-bulk">Bulk paste (one per line: label|value)</label>
      <textarea id="lg-choice-bulk" class="form-input" rows="3" data-choice-bulk placeholder="Toyota|toyota&#10;Honda|honda"></textarea>
      <button type="button" class="btn btn-sm btn-secondary" id="lg-choice-bulk-apply">Apply bulk paste</button>
    </div>
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
      <select class="form-input" data-inspector-cond="when" aria-label="Depends on field"><option value="">— always visible —</option></select>
      <select class="form-input" data-inspector-cond="op" aria-label="Condition operator">${opOptions}</select>
      <select class="form-input" data-inspector-cond="value-bool" aria-label="Boolean value" hidden><option value="true">true</option><option value="false">false</option></select>
      <select class="form-input" data-inspector-cond="value-enum" aria-label="Choice value" hidden></select>
      <input class="form-input" type="text" data-inspector-cond="value" placeholder="value" aria-label="Condition value" />
      <input class="form-input" type="number" data-inspector-cond="from" placeholder="from" aria-label="Range from" hidden />
      <input class="form-input" type="number" data-inspector-cond="to" placeholder="to" aria-label="Range to" hidden />
      <input class="form-input" type="text" data-inspector-cond="values" placeholder="values, comma-separated" aria-label="Condition values" hidden />
    </fieldset>
  </div>

  <div class="studio-panel" data-studio-panel="mapping" role="tabpanel" hidden>
    <p class="form-help">This component&#39;s <code>internal_field</code> mapping status per selected Offer (§8.6). Quick-map picks the Offer&#39;s schema field — never a typed path.</p>
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
    <details class="studio-advanced-json">
      <summary>Raw node JSON (Advanced — the only raw JSON surface, §6.14)</summary>
      <textarea id="lg-node-json" class="form-input" rows="8" data-studio-node-json aria-label="Raw component node JSON"></textarea>
      <button type="button" class="btn btn-sm btn-secondary" id="lg-node-json-apply">Apply JSON</button>
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
  <div class="lg-viewport-toggle" role="group" aria-label="Preview viewport">
    <button type="button" class="btn btn-sm btn-secondary active" data-preview-viewport="desktop" aria-pressed="true">Desktop</button>
    <button type="button" class="btn btn-sm btn-secondary" data-preview-viewport="mobile" aria-pressed="false">Mobile</button>
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

// §8.7 (E2) mapping-panel table columns — the normative order.
const MAPPING_TABLE_COLUMNS = [
  "Offer",
  "Provider",
  "Placement",
  "Payload schema version",
  "Required fields",
  "Mapped fields",
  "Mapping status",
  "Action",
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
  <div class="studio-drawer-panel" data-studio-drawer-panel="preview">
    ${renderPreviewPanel()}
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
  <div class="card studio-cell-library">${renderStudioLibrary(design)}</div>
  <div class="card studio-cell-canvas">${renderStudioCanvas(view.content, design)}</div>
  <div class="card studio-cell-inspector">${renderStudioInspector(design)}</div>
</div>
${renderStudioDrawer(summary, answerMapCount)}
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
/* §8.8 linked-field chips + key-missing banner */
.studio-maps-chip{display:inline-block;font-size:10px;color:#055160;background:#cff4fc;border:1px solid #b6effb;border-radius:999px;padding:1px 8px;margin:2px 0 0;pointer-events:none;user-select:none}
.studio-maps-banner{font-size:12px;color:#664d03;background:#fff3cd;border:1px solid #ffecb5;border-radius:6px;padding:6px 10px;margin:0 0 12px}
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

  var componentSeeds = {};
  var seedEl = document.getElementById('lg-component-seeds');
  if (seedEl) { try { componentSeeds = JSON.parse(seedEl.textContent || '{}'); } catch (e2) { componentSeeds = {}; } }
  var studioMeta = { max_depth: 4, types: {} };
  var metaEl = document.getElementById('lg-studio-meta');
  if (metaEl) { try { studioMeta = JSON.parse(metaEl.textContent || '{}'); } catch (e3) { studioMeta = { max_depth: 4, types: {} }; } }
  if (!studioMeta.types) { studioMeta.types = {}; }
  var MAX_DEPTH = studioMeta.max_depth || 4;

  var selectedQuestionId = null;
  var pendingInsert = null;
  var currentInspectorTab = 'content';
  var dirty = false;
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
    var ref = findRef(qid);
    if (!ref) { return ''; }
    var parts = [], i;
    for (i = 0; i < ref.trail.length; i++) { parts.push(ref.trail[i].type); }
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
    if (req.choice_image) { c.imageMediaId = 'media_option_' + n; }
    return c;
  }
  function defaultTextFor(type, key) {
    if (key === 'html' || key === 'panelHtml') { return 'Copy for ' + type; }
    if (key === 'logoMediaId') { return 'media_logo'; }
    return 'New ' + type + ' text';
  }
  function makeNode(type) {
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
      showRefusal('Cannot nest ' + type + ' deeper than ' + MAX_DEPTH + ' container levels — drop refused.');
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
    var i;
    if (node.children) { for (i = 0; i < node.children.length; i++) { regenerateIds(node.children[i]); } }
  }
  function duplicateNode(qid) {
    var ref = findRef(qid);
    if (!ref) { return null; }
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
      var label = node.type + (node.internal_field ? ' (' + node.internal_field + ')' : '');
      if (!meta) { issues.push({ qid: node.question_id, message: 'Unknown component type ' + node.type }); return; }
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
        if (trimStr(props[k]) === '') { issues.push({ qid: node.question_id, message: label + ' needs props.' + k }); }
      }
      var np = req.numeric_props || [];
      for (i = 0; i < np.length; i++) {
        k = np[i];
        if (typeof props[k] !== 'number' || !isFinite(props[k])) { issues.push({ qid: node.question_id, message: label + ' needs numeric props.' + k }); }
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

  function afterModelChange() {
    markDirty();
    clearRefusal();
    renderIssues();
    renderMapsBanner();
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
    canvasTimer = setTimeout(function () { canvasTimer = null; renderCanvasNow(); }, 300);
  }
  function renderCanvasNow() {
    var region = document.getElementById('lg-studio-canvas-render');
    if (!region) { return; }
    fetch('/api/admin/leadgen/sections/preview', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ content_json: JSON.stringify(state.content), viewport: 'desktop' })
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
  function applyCanvasDecoration() {
    var region = document.getElementById('lg-studio-canvas-render');
    if (!region) { return; }
    // §8.8 linked-field chips REBUILD per pass (the region is server HTML —
    // every re-render wipes them, so decoration re-derives from the model).
    var stale = region.querySelectorAll('.studio-maps-chip');
    var i;
    for (i = 0; i < stale.length; i++) {
      if (stale[i].parentNode) { stale[i].parentNode.removeChild(stale[i]); }
    }
    var nodes = region.querySelectorAll('[data-question-id]');
    var qid, base, ref, labels, chip;
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute('draggable', 'true');
      qid = nodes[i].getAttribute('data-question-id');
      base = withoutClasses(nodes[i].className, [SELECT_CLASS]);
      nodes[i].className = qid === selectedQuestionId ? base + ' ' + SELECT_CLASS : base;
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
  }
  function clearDropClasses() {
    var region = document.getElementById('lg-studio-canvas-render');
    if (!region) { return; }
    var marked = region.querySelectorAll('.studio-drop-before, .studio-drop-after, .studio-drop-into');
    var i;
    for (i = 0; i < marked.length; i++) { marked[i].className = withoutClasses(marked[i].className, DROP_CLASSES); }
  }

  // --- selection --------------------------------------------------------------
  function selectComponent(qid) {
    selectedQuestionId = qid || null;
    applyCanvasDecoration();
    var crumb = document.querySelector('[data-studio-breadcrumb]');
    if (crumb) { crumb.textContent = selectedQuestionId ? breadcrumbText(selectedQuestionId) : ''; }
    var toolbar = document.querySelector('[data-studio-selection-toolbar]');
    if (toolbar) { toolbar.hidden = !selectedQuestionId; }
    if (!selectedQuestionId && pendingInsert) { pendingInsert = null; updatePendingUi(); }
    populateInspector();
    renderInspectorMapping();
  }

  // --- inspector tabs ----------------------------------------------------------
  function availableTabsFor(node) {
    if (!node) { return []; }
    var meta = typeMeta(node.type);
    var tabs = [];
    if (meta.layout) {
      tabs.push('layout');
      if ((meta.content_props || []).length > 0) { tabs.push('content'); }
      tabs.push('dependencies');
      tabs.push('advanced');
      return tabs;
    }
    tabs.push('content');
    if (meta.choice) { tabs.push('choices'); }
    // Structured-prop affordance/chrome leaves (TrustBar/LogoStrip/
    // StepIndicator) author their catalog props on the Layout tab too.
    if (meta.layout_props) { tabs.push('layout'); }
    tabs.push('design');
    if (meta.produces) { tabs.push('validation'); }
    if (meta.maps) { tabs.push('maps'); }
    tabs.push('dependencies');
    if (meta.produces) { tabs.push('mapping'); }
    tabs.push('advanced');
    return tabs;
  }
  function setInspectorTab(key) {
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
    var target = document.getElementById('lg-inspector-target');
    if (target) { target.textContent = node ? 'Editing ' + node.question_id + ' (' + node.type + ')' : 'Select a component'; }
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

    // content controls: only the selected type's copy fields are visible
    var wraps = document.querySelectorAll('[data-content-prop]');
    var cp = meta.content_props || [];
    var anyContent = false;
    for (i = 0; i < wraps.length; i++) {
      k = wraps[i].getAttribute('data-content-prop');
      var on = !!node && cp.indexOf(k) !== -1;
      wraps[i].hidden = !on;
      if (on) { anyContent = true; }
    }
    var emptyNote = document.querySelector('[data-content-empty]');
    if (emptyNote) { emptyNote.hidden = anyContent || !node; }

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
      ovEls[i].value = (oval === undefined || oval === null) ? '' : String(oval);
    }
    populateValidation(node, meta);
    populateMapsPanel(node);
    populateConditional(node);
    var groups = document.querySelectorAll('[data-container-group]');
    for (i = 0; i < groups.length; i++) {
      groups[i].hidden = !node || groups[i].getAttribute('data-container-group') !== node.type;
    }
    populateContainerProps(node);
    renderChoiceEditor(node);
    populateChoiceDisplay(node);
    var dbg = document.querySelector('[data-studio-debug-id]');
    if (dbg) { dbg.textContent = node ? node.question_id : ''; }
    var jsonTa = document.getElementById('lg-node-json');
    if (jsonTa) { jsonTa.value = node ? JSON.stringify(node, null, 2) : ''; }
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
    var refs = findConditionalRefs(oldField);
    var msg = 'Mapping impact: renaming this internal field can break existing answer-to-Offer mappings that reference "' + oldField + '" (the D2 mapping panel will show exact usage).';
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
    afterModelChange();
  }

  // --- choices editor (§8.6: rows + main/Other grouping + bulk paste) -----------
  var CHOICE_FIELDS = ['label', 'value', 'analytics_id', 'icon', 'imageMediaId', 'description'];
  function choiceContainer() { return document.querySelector('[data-inspector-choices]'); }
  function buildChoiceRow(choice, isMain) {
    var wrap = document.createElement('div');
    wrap.className = 'lg-choice-row';
    wrap.setAttribute('data-choice-row', '');
    var i, inp, val;
    for (i = 0; i < CHOICE_FIELDS.length; i++) {
      inp = document.createElement('input');
      inp.className = 'form-input';
      inp.setAttribute('data-choice-field', CHOICE_FIELDS[i]);
      inp.setAttribute('placeholder', CHOICE_FIELDS[i]);
      val = choice ? choice[CHOICE_FIELDS[i]] : undefined;
      inp.value = (val === undefined || val === null) ? '' : String(val);
      inp.addEventListener('input', collectChoices);
      inp.addEventListener('change', collectChoices);
      wrap.appendChild(inp);
    }
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
    return wrap;
  }
  function renderChoiceEditor(node) {
    var c = choiceContainer();
    if (!c) { return; }
    clearChildren(c);
    var choices = (node && node.choices && node.choices.length) ? node.choices : [];
    var mains = (node && node.choiceDisplay && node.choiceDisplay.mainValues) ? node.choiceDisplay.mainValues : [];
    var i;
    for (i = 0; i < choices.length; i++) {
      c.appendChild(buildChoiceRow(choices[i], mains.indexOf(String(choices[i].value)) !== -1));
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
      at = line.indexOf('|');
      label = at === -1 ? line : trimStr(line.slice(0, at));
      value = at === -1 ? slugify(line) : trimStr(line.slice(at + 1));
      if (label === '') { continue; }
      if (value === '') { value = slugify(label); }
      c = { label: label, value: value, analytics_id: value };
      if (req && req.choice_icon) { c.icon = '\\u2605'; }
      if (req && req.choice_image) { c.imageMediaId = 'media_' + value; }
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
      addFromLibrary(btn.getAttribute('data-add-component'));
    });
    // the items are role="button" divs (nested-button validity) — keep the
    // native keyboard activation contract.
    libraryEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') { return; }
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-add-component]') : null;
      if (!btn) { return; }
      ev.preventDefault();
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
      var el = ev.target && ev.target.closest ? ev.target.closest('[data-question-id]') : null;
      if (!el || !canvasSurface.contains(el)) { return; }
      ev.preventDefault();
      selectComponent(el.getAttribute('data-question-id'));
    });
    canvasSurface.addEventListener('dragstart', function (ev) {
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
    });
  }

  // --- selection toolbar -----------------------------------------------------------
  var toolbarEl = document.querySelector('[data-studio-selection-toolbar]');
  if (toolbarEl) {
    toolbarEl.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-studio-act]') : null;
      if (!btn || !selectedQuestionId) { return; }
      var act = btn.getAttribute('data-studio-act');
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
      if (c) { c.appendChild(buildChoiceRow({}, false)); }
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
  function offerDeepLink(offer) { return '/admin/leadgen/offers/' + encodeURIComponent(offer.public_id) + '/edit#payload'; }
  function btn(label, attr, offerId, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = cls || 'btn btn-sm btn-outline';
    b.setAttribute(attr, String(offerId));
    b.textContent = label;
    return b;
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
    var i, offer, live, tr, td, stateEl, sel, selLabel, actions;
    for (i = 0; i < list.length; i++) {
      offer = list[i];
      live = offerLiveState(offer);
      tr = document.createElement('tr');
      tr.setAttribute('data-studio-offer-row', offer.public_id);
      td = document.createElement('td');
      td.appendChild(document.createTextNode(offer.offer_name));
      td.title = offer.public_id;
      tr.appendChild(td);
      td = document.createElement('td');
      td.appendChild(document.createTextNode(offer.provider || '\\u2014'));
      tr.appendChild(td);
      td = document.createElement('td');
      td.appendChild(document.createTextNode(offer.default_placement_id || '\\u2014'));
      tr.appendChild(td);
      td = document.createElement('td');
      td.setAttribute('data-offer-schema-version', offer.payload_schema_version === null || offer.payload_schema_version === undefined ? '' : String(offer.payload_schema_version));
      td.appendChild(document.createTextNode(offer.has_active_schema ? 'v' + offer.payload_schema_version : 'no schema'));
      tr.appendChild(td);
      td = document.createElement('td');
      td.appendChild(document.createTextNode(String(live.required_total)));
      tr.appendChild(td);
      td = document.createElement('td');
      td.setAttribute('data-offer-required-mapped', String(live.required_mapped));
      td.appendChild(document.createTextNode(live.required_mapped + '/' + live.required_total));
      tr.appendChild(td);
      td = document.createElement('td');
      stateEl = document.createElement('span');
      stateEl.className = 'studio-offer-state';
      stateEl.setAttribute('data-offer-mapping-state', live.state);
      stateEl.appendChild(document.createTextNode(offerStateLabel(live.state)));
      td.appendChild(stateEl);
      tr.appendChild(td);
      td = document.createElement('td');
      actions = document.createElement('div');
      actions.className = 'studio-pair';
      selLabel = document.createElement('label');
      selLabel.className = 'lg-check';
      sel = document.createElement('input');
      sel.type = 'checkbox';
      sel.setAttribute('data-studio-offer-select', String(offer.id));
      sel.checked = live.selected;
      selLabel.appendChild(sel);
      selLabel.appendChild(document.createTextNode('selected'));
      actions.appendChild(selLabel);
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
      body.appendChild(tr);
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
  function pathOptionLabel(f) {
    return f.path + ' \\u2014 ' + f.type + (f.required === true ? ' (required)' : '') + (f.valid_values && f.valid_values.length > 0 ? ' [' + f.valid_values.join('|') + ']' : '');
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
      pathSel.setAttribute('aria-label', 'Offer schema field');
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
    renderMapGrid();
    renderInspectorMapping();
    renderMappingCount();
    updateMappingBadge();
    renderOffersStaleNote();
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

  // Delegated wiring for the whole mapping drawer panel.
  var mappingPanel = document.querySelector('[data-studio-drawer-panel="mapping"]');
  if (mappingPanel) {
    mappingPanel.addEventListener('click', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target : null;
      if (!t) { return; }
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
      selected_offers: state.selected_offers
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
  var saveBtn = document.getElementById('lg-section-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      var errEl = document.getElementById('lg-section-error');
      if (errEl) { errEl.hidden = true; }
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
          return;
        }
        dirty = false;
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
  updateCanvasEmpty();
  applyCanvasDecoration();
  populateInspector();
  loadActivities();
  loadVerticals();
  loadOffers();
  // R5 fix-link integration: /admin/leadgen/sections/:id/edit#mapping (the
  // quote activation preflight's "Open Section Mapping" link) opens the
  // mapping drawer tab directly.
  if (window.location.hash === '#mapping') { setDrawerTab('mapping'); }
  runPreview();
}());
`;
