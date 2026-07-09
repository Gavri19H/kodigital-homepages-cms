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
  StepIndicator: { category: "chrome", produces: null, props: ["steps","current"], validation: [], events: [], tokenSlots: ["stepIndicator"], capabilityExample: "08 §8.3 Navigation: multi-step dot indicator (role=progressbar + aria-value*)" },

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
  SearchableDropdownQuestion: { category: "question", produces: "enum", props: ["internal_field","choices[]","placeholder?","required?"], validation: ["value in choices"], events: ["answer_click"], tokenSlots: ["dropdown","input"], capabilityExample: "08 §8.3/§8.10: DropdownQuestion plus a search input above the options (runtime filters client-side)" },
  OtherGroupSelector: { category: "question", produces: "enum", props: ["internal_field","choices[]","required?"], validation: ["value in choices"], events: ["answer_click"], tokenSlots: ["primaryButton","input"], capabilityExample: "08 §8.3 (B9 §6.4): main choices as answer buttons + the Other tail; auto-applied when a mapped field has choiceDisplay.otherGroupEnabled" },

  FreeTextQuestion:   { category: "question", produces: "string", props: ["internal_field","placeholder","maxLen","required","pii?"], validation: ["required","maxLen"], events: ["answer_change"], tokenSlots: ["input"] },
  NumberInputQuestion:   { category: "question", produces: "number",   props: ["internal_field","min?","max?","step?","placeholder?","required?"], validation: ["numeric","min<=value<=max when set"], events: ["answer_change","validation_error"], tokenSlots: ["input"], capabilityExample: "08 §8.3/§8.10: plain number input (inputmode=numeric) — NOT a Range variant" },
  CurrencyInputQuestion: { category: "question", produces: "currency", props: ["internal_field","currency?","min?","max?","placeholder?","required?"], validation: ["numeric","min<=value<=max when set"], events: ["answer_change","validation_error"], tokenSlots: ["input"], capabilityExample: "08 §8.10: currency-prefixed plain input (prefix from props.currency ?? \"$\") — NOT a Range variant" },
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
  SuccessState:     { category: "affordance", produces: null, props: ["heading?","message?","icon?"], validation: [], events: [], tokenSlots: ["successState"], capabilityExample: "08 §8.10: completion/success state (+ success styling)" },
  SecureFormBadge:  { category: "affordance", produces: null, props: ["text?","icon?"], validation: [], events: [], tokenSlots: ["secureFormBadge"], capabilityExample: "08 §8.3 Trust: secure-form messaging (lock badge)" },
  TrustBar:         { category: "affordance", produces: null, props: ["items[{icon,text}]","layout(horizontal|stacked)"], validation: [], events: [], tokenSlots: ["trustBar"], capabilityExample: "08 §8.3/§8.10: icon/text trust pairs, horizontal or stacked (structured props, no children)" },
  LogoStrip:        { category: "affordance", produces: null, props: ["logos[{mediaId,alt}]"], validation: [], events: [], tokenSlots: ["logoStrip"], capabilityExample: "08 §8.3/§8.10: carrier/partner logo strip" },
  HelperText:       { category: "affordance", produces: null, props: ["text"], validation: [], events: [], tokenSlots: ["validation.helper"] },
  ValidationError:  { category: "affordance", produces: null, props: [], validation: [], events: ["validation_error"], tokenSlots: ["validation"] },
  LegalNote:        { category: "affordance", produces: null, props: ["html"], validation: [], events: [], tokenSlots: ["validation.helper"] },

  // ---- layout (fix-contract v2.4 08 §8.5, issue E4 — tokenized ONLY) ----
  // Children-bearing containers (5): each may carry `children:
  // LeadgenComponentNode[]` (max depth 4; validated in content-schema.ts).
  // Containers are a SERVER-side rendering concern: presets recurse; every
  // answer/dependency/config consumer sees the flattenComponents projection.
  Stack:           { category: "layout", produces: null, props: ["direction(vertical|horizontal)","gap(xs|s|m|l|xl)","align(start|center|end|stretch)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["stack"], capabilityExample: "08 §8.5: vertical/horizontal token-gap grouping (the §8.11 stacked-buttons pattern)" },
  GridContainer:   { category: "layout", produces: null, props: ["columnsDesktop(2..5)","columnsTablet(1..4)","columnsMobile(1..2)","gap(xs|s|m|l|xl)","sizing(auto|equal)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["gridContainer"], capabilityExample: "08 §8.5: per-breakpoint column grid for card/answer regions" },
  Columns:         { category: "layout", produces: null, props: ["ratio(50/50|60/40|40/60|70/30)","mobile(stack|keep)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["columns"], capabilityExample: "08 §8.5: two-column ratio presets with mobile stacking" },
  CardPanel:       { category: "layout", produces: null, props: ["width(s|m|l|full)","background(card|wash|ghost|transparent)","shadow(none|sm|md|lg|xl)","radius(sm|md|lg|xl)","padding(s|m|l)","children[]"], validation: ["§8.5 token enums","max depth 4"], events: [], tokenSlots: ["cardPanel"], capabilityExample: "08 §8.11 pattern 1/4: the centered question card" },
  BackgroundPanel: { category: "layout", produces: null, props: ["background(card|wash|ghost|page|primary)","imageMediaId?","gradient(primary|accent|wash)?","children[]"], validation: ["§8.5 approved design tokens only"], events: [], tokenSlots: ["backgroundPanel"], capabilityExample: "08 §8.11 pattern 4: full-background design with centered card" },
  // Prop-driven layout leaves (3): NO children — structured props only.
  Spacer:          { category: "layout", produces: null, props: ["size(xs|s|m|l|xl)"], validation: ["§8.5 token enums"], events: [], tokenSlots: ["spacer"], capabilityExample: "08 §8.5: token-sized vertical gap" },
  HeaderBar:       { category: "layout", produces: null, props: ["logoMediaId?","logoAlt?","back?","backLabel?","secure?","secureText?","cta{label,href|tel}?"], validation: ["§8.5 cta shape + safe href"], events: [], tokenSlots: ["headerBar"], capabilityExample: "08 §8.11 pattern 3: header with logo + call CTA (+ back / secure slots)" },
  FooterBar:       { category: "layout", produces: null, props: ["legalHtml?","trustMessages[]?","links[{label,href}]?"], validation: ["§8.5 links shape + safe href"], events: [], tokenSlots: ["footerBar"], capabilityExample: "08 §8.11 pattern 4: legal footer with trust messaging + links" },
} as const;

export type ComponentType = keyof typeof COMPONENT_CATALOG;

// A component NOT in this catalog cannot be placed in a Section (server-validated
// on save). Adding a new capability = a new catalog entry + a render in
// components/<Type>.ts + (optionally) a style slot each visual design provides.
