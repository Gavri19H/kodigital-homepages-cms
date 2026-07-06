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
//   category        chrome | question | control | affordance
//   produces        the answer it emits (null for chrome/controls)
//   props           authorable fields (schema summary)
//   validation      rules enforced client + server
//   events          tracking events it fires (§22)
//   tokenSlots      which visual-design style slots it consumes (from designs/*)
//   capabilityExample  which screenshot/reference pattern it can reproduce

export const COMPONENT_CATALOG = {
  // ---- chrome (funnel frame; one per funnel, not per Section) ----
  ProgressBar:   { category: "chrome", produces: null, props: ["mode(step|percent)"], validation: [], events: [], tokenSlots: ["progress"] },
  HeaderLogo:    { category: "chrome", produces: null, props: ["logoMediaId"], validation: [], events: [], tokenSlots: ["header"] },
  BackButton:    { category: "chrome", produces: null, props: [], validation: [], events: ["section_view(back)"], tokenSlots: ["backButton"] },
  DisclosureLink:{ category: "chrome", produces: null, props: ["panelHtml"], validation: [], events: [], tokenSlots: ["disclosure"] },

  // ---- questions (emit a normalized answer) ----
  CategoryLabel: { category: "affordance", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["categoryLabel"] },
  QuestionHeadline: { category: "affordance", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["headline"] },
  Subheadline:   { category: "affordance", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["subheadline"] },

  RangeQuestion:         { category: "question", produces: "number",   props: ["internal_field","min","max","step","default","format(number|currency)","minLabel","maxLabel","required"], validation: ["min<=value<=max"], events: ["answer_click","answer_change"], tokenSlots: ["rangeQuestion"], capabilityExample: "screenshot: 'How much do you need?' $10k–$1M+ slider, value $330,000" },
  CurrencyRangeQuestion: { category: "question", produces: "currency", props: ["...RangeQuestion","currency"], validation: ["min<=value<=max"], events: ["answer_click","answer_change"], tokenSlots: ["rangeQuestion"], capabilityExample: "screenshot: BUSINESS LOAN currency range" },
  NumberRangeQuestion:   { category: "question", produces: "number",   props: ["...RangeQuestion"], validation: ["min<=value<=max"], events: ["answer_click","answer_change"], tokenSlots: ["rangeQuestion"] },

  ButtonAnswerGroup:  { category: "question", produces: "enum", props: ["internal_field","choices[{label,value,analytics_id}]","required","auto_advance"], validation: ["one selected if required"], events: ["answer_click"], tokenSlots: ["primaryButton","input"] },
  TwoButtonYesNo:     { category: "question", produces: "boolean", props: ["internal_field","yesLabel","noLabel","auto_advance","default?"], validation: [], events: ["answer_click","answer_default_applied"], tokenSlots: ["primaryButton"], capabilityExample: "spec: 'Are you insured?' [Yes][No]" },
  IconCardAnswerGrid: { category: "question", produces: "enum", props: ["internal_field","columns(2..5)","choices[{icon,label,description?,value,analytics_id}]","required"], validation: ["one selected if required"], events: ["answer_click"], tokenSlots: ["iconCardGrid","iconCard"], capabilityExample: "screenshot: 'What type of business?' Sole Proprietor/Partnership/LLC/C-Corp/S-Corp icon cards" },
  ImageCardAnswerGrid:{ category: "question", produces: "enum", props: ["internal_field","columns","choices[{imageMediaId,label,value}]","searchable?","required"], validation: ["one selected if required"], events: ["answer_click"], tokenSlots: ["iconCardGrid","iconCard"], capabilityExample: "reference-funnel: brand-logo make/carrier grid + card-search" },
  MultiChoiceCardGroup:{ category: "question", produces: "array", props: ["internal_field","choices[]","min","max"], validation: ["min<=count<=max"], events: ["answer_click"], tokenSlots: ["iconCard","multiChoice"] },
  DropdownQuestion:   { category: "question", produces: "enum", props: ["internal_field","choices[]","placeholder","required","conditional?"], validation: ["value in choices"], events: ["answer_click"], tokenSlots: ["dropdown"], capabilityExample: "spec: insurer dropdown shown when 'insured=yes'" },

  FreeTextQuestion:   { category: "question", produces: "string", props: ["internal_field","placeholder","maxLen","required","pii?"], validation: ["required","maxLen"], events: ["answer_change"], tokenSlots: ["input"] },
  EmailInputQuestion: { category: "question", produces: "string", props: ["internal_field","required"], validation: ["email format"], events: ["answer_change","validation_error"], tokenSlots: ["input"] },
  PhoneInputQuestion: { category: "question", produces: "string", props: ["internal_field","required","format"], validation: ["phone format"], events: ["answer_change","validation_error"], tokenSlots: ["input"] },
  NameFieldsGroup:    { category: "question", produces: "object", props: ["fields(first,last)","required"], validation: ["required per field"], events: ["answer_change"], tokenSlots: ["input"] },
  DateQuestion:       { category: "question", produces: "string", props: ["internal_field","min","max","required"], validation: ["date range"], events: ["answer_change","validation_error"], tokenSlots: ["input"] },
  ZIPInputQuestion:   { category: "question", produces: "string", props: ["internal_field","required","validate(google?)"], validation: ["/^\\d{5}$/","google validate if enabled"], events: ["answer_change","address_validation_success","address_validation_error"], tokenSlots: ["input"] },
  AddressAutocompleteQuestion: { category: "question", produces: "object", props: ["internal_fields(street,city,state,zip)","required","provider(google)"], validation: ["required","google validate"], events: ["address_autofill","address_validation_success","address_validation_error"], tokenSlots: ["input"], capabilityExample: "NET-NEW: no reference-funnel Places impl — build fresh (§27)" },

  // ---- controls + affordances ----
  ContinueButton:   { category: "control", produces: null, props: ["label","loadingLabel"], validation: ["all required answered"], events: ["continue_click","section_continue"], tokenSlots: ["primaryButton"] },
  AutoAdvanceButton:{ category: "control", produces: null, props: [], validation: [], events: ["answer_click"], tokenSlots: ["primaryButton"] },
  ReassuranceBadge: { category: "affordance", produces: null, props: ["icon","text"], validation: [], events: [], tokenSlots: ["reassuranceBadge"], capabilityExample: "screenshot: 'Get your offers in 2 minutes or less.'" },
  HelperText:       { category: "affordance", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["validation.helper"] },
  ValidationError:  { category: "affordance", produces: null, props: [], validation: [], events: ["validation_error"], tokenSlots: ["validation"] },
  LegalNote:        { category: "affordance", produces: null, props: ["html"], validation: [], events: [], tokenSlots: ["validation.helper"] },
} as const;

export type ComponentType = keyof typeof COMPONENT_CATALOG;

// A component NOT in this catalog cannot be placed in a Section (server-validated
// on save). Adding a new capability = a new catalog entry + a render in
// components/<Type>.ts + (optionally) a style slot each visual design provides.
