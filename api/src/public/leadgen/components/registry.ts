// LeadGen COMPONENT CAPABILITY REGISTRY
// Target path: api/src/public/leadgen/components/registry.ts
//
// This registry is SEPARATE from the visual design registry (designs/*). It
// owns the CATALOG of question/answer component TYPES the Section builder can
// place — WHAT each component collects, validates, and emits — independent of
// how any funnel design SKINS it. At render time a component reads the ACTIVE
// visual design's style slots (e.g. reference funnel tokens.ts); the same component
// looks different under a different design, but its capability is constant.
//
// The operator's LendingTree screenshots are CAPABILITY EXAMPLES only: they
// demonstrate that this registry can express those slides (a currency range,
// an icon-card grid, a reassurance badge). They are NOT the default look — the
// default look is the reference funnel visual design. `capabilityExample` below maps
// each screenshot pattern to the capability that produces it.
//
// Contract: every entry has
//   type            unique component id used in Section content_json
//   category        chrome | question | control | affordance | layout
//                   (layout = §8.5 containers + prop-driven layout leaves —
//                   server-side rendering concern, produces null, never
//                   projected into the public /lg/config component list)
//   scope           frame | unit | both (v2.5 08 §8.2 / 03 §3.5 — WHERE the
//                   component belongs: "frame" = Quote-frame only (removed
//                   from the Section palette; legacy nodes inside Sections
//                   render unchanged + save warning frame_scope_component),
//                   "unit" = Section palette only, "both" = placeable in a
//                   Section AND consumable by frame regions)
//   produces        the answer it emits (null for chrome/controls)
//   props           authorable fields (schema summary)
//   validation      rules enforced client + server
//   events          tracking events it fires (§22)
//   tokenSlots      which visual-design style slots it consumes (from designs/*)
//   capabilityExample  which screenshot/reference pattern it can reproduce
//
// CROSS-CUTTING NODE FIELDS (not per-type props; live on the shared node in
// content-schema.ts, validated there): `design_overrides` (§14.8 tokenized
// style) and — P3a (register PC-2 / D1 / axiom R-B) — `layout`, the STRUCTURED
// PLACEMENT bag. `layout` groups contiguous same-`row` siblings into a 2-3-slot
// side-by-side row, gives each element an `align` (start|center|end) + optional
// `width` (the SAME s/m/l/full/custom_px vocabulary as design_overrides.size)
// + a bounded `nudge` (±48px), and stacks to a column automatically at 480px
// (presets.ts renderNodes + designs/*/styles.ts `.lg-el`/`.lg-el-row`). It is a
// Section-UNIT concern: valid on any `scope: "unit"|"both"` component (answer,
// content, container), rejected on a `scope: "frame"` chrome component. Absent
// `layout` ⇒ byte-identical pre-P3a render.

// v2.5 08 §8.2 scope vocabulary (03 §3.5). The `satisfies` clause on the
// catalog makes the scope assignment compile-time EXHAUSTIVE: an entry
// missing `scope` (or carrying a value outside this union) fails tsc.
export type ComponentScope = "frame" | "unit" | "both";

interface CatalogEntryContract {
  category: "chrome" | "question" | "control" | "affordance" | "layout";
  scope: ComponentScope;
  produces: string | null;
  props: readonly string[];
  validation: readonly string[];
  events: readonly string[];
  tokenSlots: readonly string[];
  capabilityExample?: string;
}

export const COMPONENT_CATALOG = {
  // ---- chrome (funnel frame; one per funnel, not per Section) ----
  ProgressBar:   { category: "chrome", scope: "frame", produces: null, props: ["mode(step|percent)"], validation: [], events: [], tokenSlots: ["progress"] },
  HeaderLogo:    { category: "chrome", scope: "frame", produces: null, props: ["logoMediaId"], validation: [], events: [], tokenSlots: ["header"] },
  BackButton:    { category: "chrome", scope: "frame", produces: null, props: [], validation: [], events: ["section_view(back)"], tokenSlots: ["backButton"] },
  DisclosureLink:{ category: "chrome", scope: "frame", produces: null, props: ["panelHtml"], validation: [], events: [], tokenSlots: ["disclosure"] },
  StepIndicator: { category: "chrome", scope: "frame", produces: null, props: ["steps","current"], validation: [], events: [], tokenSlots: ["stepIndicator"], capabilityExample: "08 §8.3 Navigation: multi-step dot indicator (role=progressbar + aria-value*)" },

  // ---- questions (emit a normalized answer) ----
  CategoryLabel: { category: "affordance", scope: "both", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["categoryLabel"] },
  QuestionHeadline: { category: "affordance", scope: "both", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["headline"] },
  Subheadline:   { category: "affordance", scope: "both", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["subheadline"] },

  // Rework §10 / M7: the slider triplet collapsed to this ONE catalog entry. The
  // legacy RangeQuestion / CurrencyRangeQuestion types are REMOVED — migration M7
  // (0051) rewrites stored nodes to NumberRangeQuestion + props.slider_type/
  // currency_affix; a stray stored node of an extinct type validates with a clear
  // unknown_component_type error and renders the fail-safe box (never 500). §6.8
  // slider variants ride props.slider_type; the currency "$" is display-only via
  // props.currency_affix (never touches node.type/answer_type — the Image9 fix).
  NumberRangeQuestion:   { category: "question", scope: "unit", produces: "number",   props: ["internal_field","min","max","step","default","minLabel","maxLabel","required","slider_type","currency_affix"], validation: ["min<=value<=max"], events: ["answer_click","answer_change"], tokenSlots: ["rangeQuestion"], capabilityExample: "screenshot: 'How much do you need?' $10k–$1M+ slider (single/stepper/from_to/dual_range/radial, §6.8)" },

  ButtonAnswerGroup:  { category: "question", scope: "unit", produces: "enum", props: ["internal_field","choices[{label,value,analytics_id,style?}]","required","auto_advance"], validation: ["one selected if required"], events: ["answer_click"], tokenSlots: ["primaryButton","input"] },
  TwoButtonYesNo:     { category: "question", scope: "unit", produces: "boolean", props: ["internal_field","yesLabel","noLabel","auto_advance","default?","yesStyle?","noStyle?"], validation: [], events: ["answer_click","answer_default_applied"], tokenSlots: ["primaryButton"], capabilityExample: "spec: 'Are you insured?' [Yes][No]" },
  IconCardAnswerGrid: { category: "question", scope: "unit", produces: "enum", props: ["internal_field","columns(1..5)","choices[{icon,label,description?,value,analytics_id,style?}]","required"], validation: ["one selected if required"], events: ["answer_click"], tokenSlots: ["iconCardGrid","iconCard"], capabilityExample: "screenshot: 'What type of business?' Sole Proprietor/Partnership/LLC/C-Corp/S-Corp icon cards" },
  ImageCardAnswerGrid:{ category: "question", scope: "unit", produces: "enum", props: ["internal_field","columns","choices[{imageMediaId,label,value,style?}]","searchable?","required"], validation: ["one selected if required"], events: ["answer_click"], tokenSlots: ["iconCardGrid","iconCard"], capabilityExample: "reference-funnel: brand-logo make/carrier grid + card-search" },
  MultiChoiceCardGroup:{ category: "question", scope: "unit", produces: "array", props: ["internal_field","choices[]","min","max"], validation: ["min<=count<=max"], events: ["answer_click"], tokenSlots: ["iconCard","multiChoice"] },
  // Rework §10 / M6: the one-unit MultiQuestionGrid is REMOVED (owner intent —
  // §3.2 — independent components win). Migration M6 (0050) expands each stored
  // grid in place to N independent components (TwoButtonYesNo / ButtonAnswerGroup),
  // preserving every row field + the `<nodeQid>::<field>` ids. A stray stored grid
  // node validates with a clear unknown_component_type error and renders the
  // fail-safe box. The "Questions on one screen" palette starter (§4.1) replaces it.
  DropdownQuestion:   { category: "question", scope: "unit", produces: "enum", props: ["internal_field","choices[]","placeholder","required","conditional?"], validation: ["value in choices"], events: ["answer_click"], tokenSlots: ["dropdown"], capabilityExample: "spec: insurer dropdown shown when 'insured=yes'" },
  SearchableDropdownQuestion: { category: "question", scope: "unit", produces: "enum", props: ["internal_field","choices[]","placeholder?","required?"], validation: ["value in choices"], events: ["answer_click"], tokenSlots: ["dropdown","input"], capabilityExample: "08 §8.3/§8.10: DropdownQuestion plus a search input above the options (runtime filters client-side)" },
  // Rework §10 / M12: OtherGroupSelector is REMOVED — §6.5's authored props.other
  // on the single-select choice groups supersedes the B9 choiceDisplay mechanism.
  // Migration M12 (0053) rewrites stored nodes to ButtonAnswerGroup (all choices
  // become base choices); a stray stored node validates with a clear
  // unknown_component_type error and renders the fail-safe box.

  FreeTextQuestion:   { category: "question", scope: "unit", produces: "string", props: ["internal_field","placeholder","maxLen","required","pii?"], validation: ["required","maxLen"], events: ["answer_change"], tokenSlots: ["input"] },
  NumberInputQuestion:   { category: "question", scope: "unit", produces: "number",   props: ["internal_field","min?","max?","step?","placeholder?","required?"], validation: ["numeric","min<=value<=max when set"], events: ["answer_change","validation_error"], tokenSlots: ["input"], capabilityExample: "08 §8.3/§8.10: plain number input (inputmode=numeric) — NOT a Range variant" },
  CurrencyInputQuestion: { category: "question", scope: "unit", produces: "currency", props: ["internal_field","currency?","min?","max?","placeholder?","required?"], validation: ["numeric","min<=value<=max when set"], events: ["answer_change","validation_error"], tokenSlots: ["input"], capabilityExample: "08 §8.10: currency-prefixed plain input (prefix from props.currency ?? \"$\") — NOT a Range variant" },
  EmailInputQuestion: { category: "question", scope: "unit", produces: "string", props: ["internal_field","required"], validation: ["email format"], events: ["answer_change","validation_error"], tokenSlots: ["input"] },
  // v3.1 R3b E1-C6 (catalog hygiene): "format" removed from props — it was
  // documented but has zero readers/writers anywhere (renderPhoneInputQuestion
  // never consumes it, no inspector control ever wrote it). Not a schema
  // change (content-schema never enforced this prop); doc-only correction.
  PhoneInputQuestion: { category: "question", scope: "unit", produces: "string", props: ["internal_field","required"], validation: ["phone format"], events: ["answer_change","validation_error"], tokenSlots: ["input"] },
  // PC-A8 (register): First/Last each authorable independently now (label
  // already was; placeholder/helper/icon added this phase) — the Studio's
  // dedicated "First name field"/"Last name field" Basics sub-groups
  // (ui-section-studio.ts), not the generic per-type Content projection.
  NameFieldsGroup:    { category: "question", scope: "unit", produces: "object", props: ["fields(first,last)","firstPlaceholder","lastPlaceholder","firstHelper","lastHelper","firstIcon","lastIcon","required"], validation: ["required per field"], events: ["answer_change"], tokenSlots: ["input"] },
  DateQuestion:       { category: "question", scope: "unit", produces: "string", props: ["internal_field","min","max","required"], validation: ["date range"], events: ["answer_change","validation_error"], tokenSlots: ["input"] },
  ZIPInputQuestion:   { category: "question", scope: "unit", produces: "string", props: ["internal_field","required","validate(google?)"], validation: ["/^\\d{5}$/","google validate if enabled"], events: ["answer_change","address_validation_success","address_validation_error"], tokenSlots: ["input"] },
  AddressAutocompleteQuestion: { category: "question", scope: "unit", produces: "object", props: ["internal_fields(street,city,state,zip)","required","provider(google)"], validation: ["required","google validate"], events: ["address_autofill","address_validation_success","address_validation_error"], tokenSlots: ["input"], capabilityExample: "NET-NEW: no reference-funnel Places impl — build fresh (§27)" },

  // ---- controls + affordances ----
  ContinueButton:   { category: "control", scope: "unit", produces: null, props: ["label","loadingLabel"], validation: ["all required answered"], events: ["continue_click","section_continue"], tokenSlots: ["primaryButton"] },
  AutoAdvanceButton:{ category: "control", scope: "unit", produces: null, props: [], validation: [], events: ["answer_click"], tokenSlots: ["primaryButton"] },
  ReassuranceBadge: { category: "affordance", scope: "both", produces: null, props: ["icon","text"], validation: [], events: [], tokenSlots: ["reassuranceBadge"], capabilityExample: "screenshot: 'Get your offers in 2 minutes or less.'" },
  SuccessState:     { category: "affordance", scope: "both", produces: null, props: ["heading?","message?","icon?"], validation: [], events: [], tokenSlots: ["successState"], capabilityExample: "08 §8.10: completion/success state (+ success styling)" },
  SecureFormBadge:  { category: "affordance", scope: "both", produces: null, props: ["text?","icon?"], validation: [], events: [], tokenSlots: ["secureFormBadge"], capabilityExample: "08 §8.3 Trust: secure-form messaging (lock badge)" },
  TrustBar:         { category: "affordance", scope: "both", produces: null, props: ["items[{icon,text}]","layout(horizontal|stacked)"], validation: [], events: [], tokenSlots: ["trustBar"], capabilityExample: "08 §8.3/§8.10: icon/text trust pairs, horizontal or stacked (structured props, no children)" },
  LogoStrip:        { category: "affordance", scope: "both", produces: null, props: ["logos[{mediaId,alt}]"], validation: [], events: [], tokenSlots: ["logoStrip"], capabilityExample: "08 §8.3/§8.10: carrier/partner logo strip" },
  HelperText:       { category: "affordance", scope: "both", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["validation.helper"] },
  ValidationError:  { category: "affordance", scope: "unit", produces: null, props: [], validation: [], events: ["validation_error"], tokenSlots: ["validation"] },
  LegalNote:        { category: "affordance", scope: "both", produces: null, props: ["html"], validation: [], events: [], tokenSlots: ["validation.helper"] },

  // ---- v3.1 05 §5.3 Text/Image primitives (Section-palette only — scope
  // "unit", NOT "both": unlike the retired one-off types above (which stay
  // frame-reusable, untouched, for backward compat), these two NEW
  // consolidated primitives are a Section-builder-palette concept only; no
  // frame region consumes them). §5.3 "Primitives replace one-off blocks":
  // CategoryLabel/HelperText/LegalNote/ReassuranceBadge/SecureFormBadge
  // collapse into TextBlock (role-typed); HeaderLogo/LogoStrip (in-unit)
  // collapse into ImageBlock (source="auto_logo"). See content-schema.ts
  // primitiveViewOfNode/rewriteRetiredNodeToPrimitive for the migration map.
  TextBlock:        { category: "affordance", scope: "unit", produces: null, props: ["role","text?","icon?"], validation: ["role enum (§8.5b)"], events: [], tokenSlots: ["headline","categoryLabel","validation.helper","reassuranceBadge","secureFormBadge"], capabilityExample: "v3.1 05 §5.3: Text primitive (role Heading/Body/Category label/Helper/Legal/Reassurance/Secure badge) collapsing 5 retired one-off types" },
  ImageBlock:       { category: "affordance", scope: "unit", produces: null, props: ["source(media|auto_logo)","logoMediaId?","alt?"], validation: ["source enum (§5.3)"], events: [], tokenSlots: ["header"], capabilityExample: "v3.1 05 §5.3: Image/Logo primitive (source=auto_logo) collapsing HeaderLogo/LogoStrip in-unit usage" },

  // ---- layout (fix-contract v2.4 08 §8.5, issue E4 — tokenized ONLY) ----
  // Children-bearing containers (5): each may carry `children:
  // LeadgenComponentNode[]` (max depth 4; validated in content-schema.ts).
  // Containers are a SERVER-side rendering concern: presets recurse; every
  // answer/dependency/config consumer sees the flattenComponents projection.
  Stack:           { category: "layout", scope: "both", produces: null, props: ["direction(vertical|horizontal)","gap(xs|s|m|l|xl)","align(start|center|end|stretch)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["stack"], capabilityExample: "08 §8.5: vertical/horizontal token-gap grouping (the §8.11 stacked-buttons pattern)" },
  GridContainer:   { category: "layout", scope: "both", produces: null, props: ["columnsDesktop(2..5)","columnsTablet(1..4)","columnsMobile(1..2)","gap(xs|s|m|l|xl)","sizing(auto|equal)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["gridContainer"], capabilityExample: "08 §8.5: per-breakpoint column grid for card/answer regions" },
  Columns:         { category: "layout", scope: "both", produces: null, props: ["ratio(50/50|60/40|40/60|70/30)","mobile(stack|keep)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["columns"], capabilityExample: "08 §8.5: two-column ratio presets with mobile stacking" },
  CardPanel:       { category: "layout", scope: "both", produces: null, props: ["width(s|m|l|full)","background(card|wash|ghost|transparent)","shadow(none|sm|md|lg|xl)","radius(sm|md|lg|xl)","padding(s|m|l)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["cardPanel"], capabilityExample: "08 §8.11 pattern 1/4: the centered question card" },
  BackgroundPanel: { category: "layout", scope: "frame", produces: null, props: ["background(card|wash|ghost|page|primary)","imageMediaId?","gradient(primary|accent|wash)?","children[]"], validation: ["§8.5 approved design tokens only"], events: [], tokenSlots: ["backgroundPanel"], capabilityExample: "08 §8.11 pattern 4: full-background design with centered card" },
  // Prop-driven layout leaves (3): NO children — structured props only.
  // v3.1 R3b (catalog hygiene, own catch): "variant(gap|line)" was schema-legal
  // and renderer-consumed (renderSpacer's line-divider branch) but missing
  // from this doc — added for parity with content-schema's real contract.
  Spacer:          { category: "layout", scope: "both", produces: null, props: ["size(xs|s|m|l|xl)","variant(gap|line)"], validation: ["§8.5 token enums"], events: [], tokenSlots: ["spacer"], capabilityExample: "08 §8.5: token-sized vertical gap" },
  HeaderBar:       { category: "layout", scope: "frame", produces: null, props: ["logoMediaId?","logoAlt?","back?","backLabel?","secure?","secureText?","cta{label,href|tel}?"], validation: ["§8.5 cta shape + safe href"], events: [], tokenSlots: ["headerBar"], capabilityExample: "08 §8.11 pattern 3: header with logo + call CTA (+ back / secure slots)" },
  FooterBar:       { category: "layout", scope: "frame", produces: null, props: ["legalHtml?","trustMessages[]?","links[{label,href}]?"], validation: ["§8.5 links shape + safe href"], events: [], tokenSlots: ["footerBar"], capabilityExample: "08 §8.11 pattern 4: legal footer with trust messaging + links" },
} as const satisfies Record<string, CatalogEntryContract>;

export type ComponentType = keyof typeof COMPONENT_CATALOG;

// ---------------------------------------------------------------------------
// LeadGen Rework §6.2 — the per-type inspector CONTROL-CAPABILITY matrix.
// ---------------------------------------------------------------------------
// The systemic #10 fix: inspector controls render from per-type capability
// FLAGS instead of ad-hoc `hidden` toggles scattered through the studio island
// (§6.2 "Controls render from per-type capability flags ... The ad-hoc
// per-control `hidden` flags ... consolidate onto this one spec-driven
// mechanism"). This is DATA — the SINGLE source of truth shared by the Studio
// (S2.4, which renders exactly the flagged controls) and the schema validator
// (content-schema.ts, which GATES props to the flagged capabilities so the
// authoring surface and the save gate can never disagree) and the §6.2 matrix
// test (S2.5). Every row/column of the contract's §6.2 table is transcribed
// below verbatim; `satisfies Record<ComponentType, …>` makes it compile-time
// EXHAUSTIVE (a new/removed catalog type forces a matching change here).
//
// Cell vocabulary (matching the matrix's non-✓/blank cells):
//   * `"labels_only"` — YesNo shows a labels-only choice editor (Yes/No copy),
//     not the full add/remove choice grid.
//   * `"per_field"` — Address / NameFields render the control PER SUB-FIELD
//     (existing convention), not once for the whole node.
//   * `default_kind` — WHICH default control the type offers (§6.4): a YesNo
//     toggle, a range value, a dropdown option, a choice pick, or none.
export interface ComponentCapabilitySpec {
  /** §6.3 Label + helper block. `"per_field"` = per sub-field (NameFields). */
  label_helper: boolean | "per_field";
  /** Required toggle. `"per_field"` = per sub-field (Address/NameFields). */
  required: boolean | "per_field";
  /** Choices editor (+ bulk paste). `"labels_only"` = YesNo Yes/No labels. */
  choices_editor: boolean | "labels_only";
  /** §6.5 "Other" values editor — SINGLE-select choice groups only. */
  other_editor: boolean;
  /** §6.4 default control kind — null = no default control on this type. */
  default_kind: "yesno" | "range" | "dropdown" | "choice" | null;
  /** §6.6 ✓-in-selected marker style (per-node, over the theme axis). */
  selected_marker: boolean;
  /** Column-count control (answer grids + containers). */
  columns: boolean;
  /** §5.6 Accept type-swap (text-input family + Phone). */
  accept_type_swap: boolean;
  /** §6.9 phone mask builder — Phone only. */
  mask_builder: boolean;
  /** §6.8 slider-type picker — Slider only. */
  slider_type: boolean;
  /** §6.10 address field-set + Maps editor — Address only. */
  field_set_maps: boolean;
  /** Placeholder control. `"per_field"` = per sub-field (Address/NameFields). */
  placeholder: boolean | "per_field";
}

const CAP_NONE: ComponentCapabilitySpec = {
  label_helper: false,
  required: false,
  choices_editor: false,
  other_editor: false,
  default_kind: null,
  selected_marker: false,
  columns: false,
  accept_type_swap: false,
  mask_builder: false,
  slider_type: false,
  field_set_maps: false,
  placeholder: false,
};

// Buttons / Icon cards / Image cards — the SINGLE-select choice groups (§6.2
// row set: Label+helper ✓, Required ✓, Choices editor ✓, Other editor ✓,
// Default ✓ 'choice', Selected-marker ✓, Columns ✓).
const CAP_CHOICE_SINGLE: ComponentCapabilitySpec = {
  ...CAP_NONE,
  label_helper: true,
  required: true,
  choices_editor: true,
  other_editor: true,
  default_kind: "choice",
  selected_marker: true,
  columns: true,
};

// Text-input family (FreeText / Email / Number / Currency / Date / ZIP):
// Label+helper ✓, Required ✓, Accept type-swap ✓, Placeholder ✓.
const CAP_TEXT_INPUT: ComponentCapabilitySpec = {
  ...CAP_NONE,
  label_helper: true,
  required: true,
  accept_type_swap: true,
  placeholder: true,
};

// Dropdown / Searchable: Label+helper ✓, Required ✓, Choices editor ✓,
// Default ✓ 'dropdown' (existing), Placeholder ✓. NO Other editor (the #10
// fix: Dropdown shows no Other-group control), NO selected-marker, NO columns.
const CAP_DROPDOWN: ComponentCapabilitySpec = {
  ...CAP_NONE,
  label_helper: true,
  required: true,
  choices_editor: true,
  default_kind: "dropdown",
  placeholder: true,
};

// Slider (the ONE NumberRangeQuestion catalog entry, §10/M7 collapse):
// Label+helper ✓, Required ✓, Default ✓ 'range' (existing), Slider type ✓.
const CAP_SLIDER: ComponentCapabilitySpec = {
  ...CAP_NONE,
  label_helper: true,
  required: true,
  default_kind: "range",
  slider_type: true,
};

// Layout containers: only the Columns control (matrix Containers column).
const CAP_CONTAINER: ComponentCapabilitySpec = { ...CAP_NONE, columns: true };

export const COMPONENT_CAPABILITIES = {
  // chrome — no Section-inspector controls.
  ProgressBar: CAP_NONE,
  HeaderLogo: CAP_NONE,
  BackButton: CAP_NONE,
  DisclosureLink: CAP_NONE,
  StepIndicator: CAP_NONE,

  // copy affordances — no answer controls.
  CategoryLabel: CAP_NONE,
  QuestionHeadline: CAP_NONE,
  Subheadline: CAP_NONE,

  // range family (the ONE collapsed Slider, §10/M7).
  NumberRangeQuestion: CAP_SLIDER,

  // choice questions.
  ButtonAnswerGroup: CAP_CHOICE_SINGLE,
  // YesNo: Label+helper ✓, Required ✓, Choices editor "labels only",
  // Default ✓ 'yesno', Selected-marker ✓ — but NO Other editor, NO Columns.
  TwoButtonYesNo: {
    ...CAP_NONE,
    label_helper: true,
    required: true,
    choices_editor: "labels_only",
    default_kind: "yesno",
    selected_marker: true,
  },
  IconCardAnswerGrid: CAP_CHOICE_SINGLE,
  ImageCardAnswerGrid: CAP_CHOICE_SINGLE,
  // MultiChoice: like the single-select groups BUT no Other editor and NO
  // default (§6.4 "Multi-select has no default in v1").
  MultiChoiceCardGroup: {
    ...CAP_NONE,
    label_helper: true,
    required: true,
    choices_editor: true,
    selected_marker: true,
    columns: true,
  },
  DropdownQuestion: CAP_DROPDOWN,
  SearchableDropdownQuestion: CAP_DROPDOWN,

  // free-form + PII inputs.
  FreeTextQuestion: CAP_TEXT_INPUT,
  NumberInputQuestion: CAP_TEXT_INPUT,
  CurrencyInputQuestion: CAP_TEXT_INPUT,
  EmailInputQuestion: CAP_TEXT_INPUT,
  // Phone: the text-input family PLUS the §6.9 mask builder.
  PhoneInputQuestion: { ...CAP_TEXT_INPUT, mask_builder: true },
  // NameFields/Contact: every control is PER-FIELD (existing convention).
  NameFieldsGroup: {
    ...CAP_NONE,
    label_helper: "per_field",
    required: "per_field",
    placeholder: "per_field",
  },
  DateQuestion: CAP_TEXT_INPUT,
  ZIPInputQuestion: CAP_TEXT_INPUT,
  // Address: Label+helper ✓, Required per-field, Field set + Maps ✓,
  // Placeholder per-field.
  AddressAutocompleteQuestion: {
    ...CAP_NONE,
    label_helper: true,
    required: "per_field",
    field_set_maps: true,
    placeholder: "per_field",
  },

  // controls + remaining affordances — no answer controls.
  ContinueButton: CAP_NONE,
  AutoAdvanceButton: CAP_NONE,
  ReassuranceBadge: CAP_NONE,
  SuccessState: CAP_NONE,
  SecureFormBadge: CAP_NONE,
  TrustBar: CAP_NONE,
  LogoStrip: CAP_NONE,
  HelperText: CAP_NONE,
  ValidationError: CAP_NONE,
  LegalNote: CAP_NONE,
  TextBlock: CAP_NONE,
  ImageBlock: CAP_NONE,

  // layout containers + leaves.
  Stack: CAP_CONTAINER,
  GridContainer: CAP_CONTAINER,
  Columns: CAP_CONTAINER,
  CardPanel: CAP_CONTAINER,
  BackgroundPanel: CAP_CONTAINER,
  Spacer: CAP_NONE,
  HeaderBar: CAP_NONE,
  FooterBar: CAP_NONE,
} as const satisfies Record<ComponentType, ComponentCapabilitySpec>;

// A component NOT in this catalog cannot be placed in a Section (server-validated
// on save). Adding a new capability = a new catalog entry + a render in
// components/<Type>.ts + (optionally) a style slot each visual design provides.
