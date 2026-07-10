// LeadGen Section `content_json` — the TypeScript CONTRACT every consumer
// shares (contract 05 §12.3 / §13.1 / §14.8). A Section body is an ordered
// list of component nodes drawn from the component CAPABILITY catalog
// (components/registry.ts); each node carries its authorable props, an
// optional inline dependency (`conditional`), a design-preset selection, and
// a curated (never free-CSS) `design_overrides` bag.
//
// `validateSectionContent` is PURE (no I/O) and returns FIELD-PATH-keyed typed
// errors, mirroring the Offer-validator idiom (leadgen/validation.ts). The
// server runs it on save (client validation is never trusted, §12.3); the
// same shape is what the runtime engine + preview consume. Referential checks
// against Offers (answer→payload mapping) are a Stage-B/handler concern —
// this validator is content-internal only.

import { FUNNEL_TOKEN_ROLES } from "../designs/theme";
import { COMPONENT_CATALOG } from "./registry";
import type { ComponentType } from "./registry";
import type { LeadgenConditionOp } from "../../../admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// Node + content types
// ---------------------------------------------------------------------------

// The normalized answer a component emits (the catalog `produces`, minus the
// chrome/control `null`). Alias for a Section node's `answer_type`.
export type LeadgenAnswerType =
  | "number"
  | "currency"
  | "enum"
  | "boolean"
  | "array"
  | "object"
  | "string";

// One authorable answer choice (§13.1 per-choice fields). `value` is the
// normalized UI value; `analytics_id` is its stable tracking id (§22).
//
// v2.5 08 §8.4 ADDITIVE extension: `title`/`subtitle`/`badge`/`emoji`/
// `image_alt`/`disabled`/`aria_label`. `subtitle` SUPERSEDES `description`
// (which stays as a read alias — no migration). Validator rules (§8.4):
// `image_alt` REQUIRED when `imageMediaId` is present on ImageCardAnswerGrid
// (reuses `invalid_choice`); `emoji` and `icon` are mutually exclusive.
export interface LeadgenChoice {
  label: string;
  value: string | number | boolean;
  analytics_id: string;
  icon?: string;
  // legacy read alias — superseded by `subtitle` (v2.5 §8.4)
  description?: string;
  imageMediaId?: string;
  title?: string;
  subtitle?: string;
  badge?: string;
  emoji?: string;
  image_alt?: string;
  disabled?: boolean;
  aria_label?: string;
}

// B9 Other-group display metadata MIRROR (fix-contract v2.4 06 §6.4) — the
// schema-side original lives on the Offer payload node (payload.ts
// LeadgenPayloadChoiceDisplay); a Section node carries this mirrored copy
// where it renders the choices. Every field is OPTIONAL in storage: the
// Phase-1 render leg (presets.ts readChoiceDisplay — the SINGLE normalizing
// reader) applies the contract defaults (otherGroupLabel → "Other",
// booleans → false). This module only VALIDATES the authored value.
export interface LeadgenComponentChoiceDisplay {
  // Choice values (matched by String(choice.value)) shown as normal choices;
  // the rest fold into the "Other" secondary panel.
  mainValues?: string[];
  otherGroupEnabled?: boolean;
  otherGroupLabel?: string;
  searchableOther?: boolean;
}

// Inline dependency stored on a component (§12.3): "show/require this when
// field <when> <op> <value>". `op` reuses the canonical LeadGen condition-op
// vocabulary (db-types.ts / payload.ts — eq|neq|gt|lt|gte|lte|range|in|not_in).
export interface LeadgenComponentConditional {
  when: string;
  op: LeadgenConditionOp;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
}

// ---------------------------------------------------------------------------
// v2.5 03 §3.4 canonical headline binding — the bind VALUE vocabulary and the
// ONE component type each value is legal on (`bind_type_mismatch` otherwise).
// A bound node's text is the Section's headline/subheadline COLUMN, resolved
// at render — so a bound node must NOT carry props.text
// (`bound_node_carries_text`), and each bind value may appear at most once
// per Section, whole tree (`duplicate_bind`). flattenComponents ignores
// `bind` entirely (a bound node projects like any other affordance leaf).
// ---------------------------------------------------------------------------

export const LEADGEN_COMPONENT_BINDS = ["section_headline", "section_subheadline"] as const;
export type LeadgenComponentBind = (typeof LEADGEN_COMPONENT_BINDS)[number];

const BIND_SET: ReadonlySet<string> = new Set(LEADGEN_COMPONENT_BINDS);

const BIND_EXPECTED_TYPE: Record<LeadgenComponentBind, ComponentType> = {
  section_headline: "QuestionHeadline",
  section_subheadline: "Subheadline",
};

// The curated design-override key set (§14.8 "safe, tokenized — no arbitrary
// CSS"). §14.8 enumerates the inspector's tokenized style controls; the ones
// that write per-component STYLE token values into `design_overrides` are:
//   icon color token · card layout selector (columns) / card count per row ·
//   feature color token · range color token · button background token ·
//   button text token · answer-grid gap token · per-component mobile behavior.
// (The preset selector, per-choice icon selector, badge enable/icon/text and
// helper text are node CONTENT/structure fields — `design_preset`, `choices`,
// `props` — not style overrides.) `design_overrides` accepts ONLY these keys;
// any other key is rejected at save (§14.8 "unknown keys are rejected";
// §14.10 "no arbitrary-CSS escapes").
export const CURATED_DESIGN_OVERRIDE_KEYS = [
  "iconColor",
  "columns",
  "featureColor",
  "rangeColor",
  "buttonBackground",
  "buttonText",
  "gridGap",
  "mobileBehavior",
] as const;

export type CuratedDesignOverrideKey = (typeof CURATED_DESIGN_OVERRIDE_KEYS)[number];

const CURATED_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);

// A design override value is a fixed token reference / scalar — NEVER a CSS
// string. `LeadgenDesignOverrides` is a partial map over the curated keys.
export type LeadgenDesignOverrides = Partial<
  Record<CuratedDesignOverrideKey, string | number | boolean>
>;

// ---------------------------------------------------------------------------
// v2.5 09 §9.4 — color-typed design_overrides VALUE vocabulary.
// ---------------------------------------------------------------------------

// The 14 semantic color roles (09 §9.1) — the ONLY color vocabulary in normal
// flows. Canonical list: designs/theme.ts (ROLE_TO_BASE_TOKEN keys); re-exported
// here under the schema-local name so validation and the theme layer can never
// drift.

export const LEADGEN_THEME_ROLES = FUNNEL_TOKEN_ROLES;

export type LeadgenThemeRole = (typeof LEADGEN_THEME_ROLES)[number];

const THEME_ROLE_SET: ReadonlySet<string> = new Set(LEADGEN_THEME_ROLES);

// The curated override keys whose VALUE is a color (per how presets.ts
// consumes them: featureColor → categoryLabel color, rangeColor → range fill
// background-color, iconColor → card icon color, buttonBackground →
// --lg-btn-bg, buttonText → button color). The other keys (columns, gridGap,
// mobileBehavior) are structural/spacing-typed — the §9.4 rule does NOT apply
// to them.
export const COLOR_TYPED_OVERRIDE_KEYS = [
  "iconColor",
  "featureColor",
  "rangeColor",
  "buttonBackground",
  "buttonText",
] as const satisfies readonly CuratedDesignOverrideKey[];

const COLOR_TYPED_KEY_SET: ReadonlySet<string> = new Set(COLOR_TYPED_OVERRIDE_KEYS);

// §9.4/§9.6: a legacy raw `#hex` literal stays VALID (existing stored/seeded
// content carries raw design-token hex from curatedTokenOptions — rendered
// as-is, surfaced in the UI as "Custom color (legacy)"). Anything that is
// neither a known role nor a #hex literal → `invalid_override_value`.
const LEGACY_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function isValidColorOverrideValue(value: unknown): boolean {
  return typeof value === "string" && (THEME_ROLE_SET.has(value) || LEGACY_HEX_RE.test(value));
}

// One component node in a Section's `content_json`.
//
// LAYOUT CONTAINERS (fix-contract v2.4 08 §8.5, issue E4): a node whose type
// is one of the 5 children-bearing container types (LEADGEN_CONTAINER_TYPES)
// may additionally carry `children` — an ordered sub-tree of nodes — plus an
// optional stable `container_id`. Both fields live on the SHARED node
// interface (pragmatic: one parse type for the whole tree); the VALIDATOR
// enforces "children only on container types", the depth-4 cap, and that
// containers never carry answer fields. A flat array (zero containers) is the
// degenerate tree and validates + renders byte-identically to pre-§8.5
// content (§8.13 legacy compat: "flat legacy arrays render as an implicit
// root Stack" — i.e. the root list itself).
export interface LeadgenComponentNode {
  type: ComponentType;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: LeadgenAnswerType;
  required?: boolean;
  valid_values?: Array<string | number | boolean>;
  choices?: LeadgenChoice[];
  // B9 §6.4 mirrored Other-group display metadata (choice components only).
  choiceDisplay?: LeadgenComponentChoiceDisplay;
  conditional?: LeadgenComponentConditional;
  // §3.4 canonical headline binding: "section_headline" is legal ONLY on a
  // QuestionHeadline, "section_subheadline" ONLY on a Subheadline; at most one
  // node per bind value per Section; a bound node carries NO props.text (its
  // text is the Section column, resolved at render). Ignored by
  // flattenComponents and every non-renderer consumer.
  bind?: LeadgenComponentBind;
  design_preset?: string;
  design_overrides?: LeadgenDesignOverrides;
  // Per-type authorable extras (min/max/step/labels/placeholder/text/html/
  // logoMediaId/columns/…). Preset-specific; presets read them defensively.
  props?: Record<string, unknown>;
  // §8.5 container extension — VALID ONLY on the 5 container types (validator-
  // enforced); a leaf carrying children is a typed error.
  children?: LeadgenComponentNode[];
  container_id?: string;
}

export interface LeadgenSectionContent {
  components: LeadgenComponentNode[];
}

// ---------------------------------------------------------------------------
// §8.5 layout containers — the container-type vocabulary + the ONE canonical
// flatten helper every answer/dependency/config consumer shares.
// ---------------------------------------------------------------------------

// The 5 children-BEARING container types (§8.5). The 3 prop-driven layout
// leaves (Spacer / HeaderBar / FooterBar) are NOT here — they carry no
// children and flow through flattenComponents like any other leaf.
export const LEADGEN_CONTAINER_TYPES = [
  "Stack",
  "GridContainer",
  "Columns",
  "CardPanel",
  "BackgroundPanel",
] as const;

export type LeadgenContainerType = (typeof LEADGEN_CONTAINER_TYPES)[number];

const CONTAINER_TYPE_SET: ReadonlySet<string> = new Set(LEADGEN_CONTAINER_TYPES);

// §8.5 "max depth 4": container nesting is capped at 4 container levels. The
// cap doubles as the circularity guard — neither the validator nor the
// flatten walk ever descends past it, so a (non-JSON) cyclic object
// terminates instead of recursing forever.
export const LEADGEN_MAX_CONTAINER_DEPTH = 4;

// True when `type` names a children-bearing §8.5 layout container.
export function isLayoutContainerType(type: unknown): type is LeadgenContainerType {
  return typeof type === "string" && CONTAINER_TYPE_SET.has(type);
}

// THE canonical flatten: every non-container node of the tree in depth-first
// render order. Containers are a SERVER-side rendering concern — every
// consumer that iterates a Section's components for questions / answers /
// dependencies / config projection consumes THIS list; ONLY the validator and
// the preset renderer recurse the tree. For flat legacy content (zero
// containers) the result is the input list unchanged (same nodes, same
// order — §8.13). Defensive: non-object junk entries pass through exactly as
// they always did in the flat world (callers keep their own isRecord guards);
// a container nested beyond the depth cap is not descended into (the
// validator is the gate; this walk just refuses to blow the stack).
export function flattenComponents(
  components: readonly LeadgenComponentNode[],
): LeadgenComponentNode[] {
  const out: LeadgenComponentNode[] = [];
  const walk = (nodes: readonly LeadgenComponentNode[], depth: number): void => {
    for (const node of nodes) {
      const type =
        typeof node === "object" && node !== null ? (node as { type?: unknown }).type : undefined;
      if (isLayoutContainerType(type)) {
        if (depth >= LEADGEN_MAX_CONTAINER_DEPTH + 1) continue; // corrupt over-deep data
        const children = (node as { children?: unknown }).children;
        if (Array.isArray(children)) walk(children as LeadgenComponentNode[], depth + 1);
      } else {
        out.push(node);
      }
    }
  };
  walk(components, 1);
  return out;
}

// ---------------------------------------------------------------------------
// Typed validation errors
// ---------------------------------------------------------------------------

export type SectionContentErrorCode =
  | "content_not_object"
  | "components_not_array"
  | "components_empty"
  | "node_not_object"
  | "unknown_component_type"
  | "missing_question_id"
  | "duplicate_question_id"
  | "duplicate_question_key"
  | "duplicate_internal_field"
  | "missing_required_field"
  | "invalid_choice"
  | "invalid_valid_values"
  | "answer_type_mismatch"
  | "conditional_invalid"
  | "conditional_unknown_field"
  | "non_curated_override_key"
  | "arbitrary_css_override"
  | "choice_display_invalid"
  // §8.5 layout-container errors
  | "container_depth_exceeded"
  | "children_not_allowed"
  | "container_answer_field_forbidden"
  | "container_prop_invalid"
  // v2.5 §3.4 canonical headline binding errors
  | "bind_type_mismatch"
  | "duplicate_bind"
  | "bound_node_carries_text"
  // v2.5 §9.4 color-typed override VALUE vocabulary (role name or legacy #hex)
  | "invalid_override_value"
  // v2.5 §3.5/§8.2 WARNING code (emitted into `warnings`, never `errors`)
  | "frame_scope_component"
  // v2.5 11 §11.5 WARNING code (emitted into `warnings`, never `errors`)
  | "duplicate_continue";

export interface SectionContentError {
  code: SectionContentErrorCode;
  path: string;
  message: string;
}

export interface SectionContentValidation {
  ok: boolean;
  errors: SectionContentError[];
  // v2.5 08 §8.6 ADDITIVE: non-blocking problems (`frame_scope_component`).
  // `ok` stays keyed to `errors` ONLY — a Section with warnings saves fine
  // (severity escalation to a blocking error happens at Quote
  // publish/activation, 14 §14.1 — outside this validator).
  warnings: SectionContentError[];
}

// ---------------------------------------------------------------------------
// Required-field table (derived from the catalog `props` contract). A prop
// listed WITHOUT a trailing `?` in components/registry.ts is required; this
// table is the curated, exhaustive resolution of that contract per type
// (with the `...RangeQuestion` spread resolved). A new ComponentType added to
// the catalog forces a new row here (compile error otherwise) — keeping the
// content contract and the capability catalog in lockstep.
// ---------------------------------------------------------------------------

// Exported (read-only) so the Section Studio (admin/leadgen/ui-section-studio)
// can PROJECT the same required-field truth into its island bootstrap for the
// live in-editor validation chip — one table, no drift. The server-side
// validateSectionContent below stays the authoritative gate on save.
export interface RequiredSpec {
  internalField?: boolean; // catalog props include "internal_field"
  choices?: boolean; // catalog props include a "choices…" token
  choiceIcon?: boolean; // §14.4: each choice needs an icon
  choiceImage?: boolean; // catalog choices[{imageMediaId,…}]
  textProps?: readonly string[]; // simple required scalar props (in node.props)
  numericProps?: readonly string[]; // required numeric props (in node.props)
}

export const REQUIRED_FIELDS: Record<ComponentType, RequiredSpec> = {
  // chrome
  ProgressBar: {},
  HeaderLogo: { textProps: ["logoMediaId"] },
  BackButton: {},
  DisclosureLink: { textProps: ["panelHtml"] },
  StepIndicator: {}, // props (steps/current) read defensively by the preset

  // affordances (copy)
  CategoryLabel: { textProps: ["text"] },
  QuestionHeadline: { textProps: ["text"] },
  Subheadline: { textProps: ["text"] },
  // range family (§14.5)
  RangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  CurrencyRangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  NumberRangeQuestion: { internalField: true, numericProps: ["min", "max"] },
  // choice questions
  ButtonAnswerGroup: { internalField: true, choices: true },
  TwoButtonYesNo: { internalField: true },
  IconCardAnswerGrid: { internalField: true, choices: true, choiceIcon: true },
  ImageCardAnswerGrid: { internalField: true, choices: true, choiceImage: true },
  MultiChoiceCardGroup: { internalField: true, choices: true },
  DropdownQuestion: { internalField: true, choices: true },
  SearchableDropdownQuestion: { internalField: true, choices: true },
  OtherGroupSelector: { internalField: true, choices: true },
  // free-form + PII inputs
  FreeTextQuestion: { internalField: true },
  NumberInputQuestion: { internalField: true },
  CurrencyInputQuestion: { internalField: true },
  EmailInputQuestion: { internalField: true },
  PhoneInputQuestion: { internalField: true },
  NameFieldsGroup: {}, // uses `fields(first,last)` — no single internal_field
  DateQuestion: { internalField: true },
  ZIPInputQuestion: { internalField: true },
  AddressAutocompleteQuestion: {}, // uses `internal_fields(street,city,state,zip)`
  // controls + remaining affordances
  ContinueButton: {},
  AutoAdvanceButton: {},
  ReassuranceBadge: { textProps: ["text"] },
  SuccessState: {}, // heading/message/icon all optional; preset reads defensively
  SecureFormBadge: {}, // text/icon optional (token exampleCopy fallback)
  TrustBar: {}, // props.items read defensively by the preset
  LogoStrip: {}, // props.logos read defensively by the preset
  HelperText: { textProps: ["text"] },
  ValidationError: {},
  LegalNote: { textProps: ["html"] },
  // §8.5 layout containers + layout leaves: every prop is OPTIONAL (presets
  // apply token defaults); when PRESENT it must pass the §8.5 token-enum
  // check (validateContainerProps) — not this generic required-field table.
  Stack: {},
  GridContainer: {},
  Columns: {},
  CardPanel: {},
  BackgroundPanel: {},
  Spacer: {},
  HeaderBar: {},
  FooterBar: {},
};

const CONDITION_OPS: ReadonlySet<string> = new Set<LeadgenConditionOp>([
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "range",
  "in",
  "not_in",
]);

// ---------------------------------------------------------------------------
// §8.5 container prop token enums — TOKEN-VALUED only, no raw CSS. These are
// the AUTHORING vocabulary; each design maps them to measured CSS values in
// its token file (default-funnel/tokens.ts stack/gridContainer/columns/
// cardPanel/backgroundPanel/spacer/headerBar/footerBar groups) and the preset
// resolves the enum → token value at render (components/presets.ts).
// ---------------------------------------------------------------------------

// Shared gap / spacer size scale (xs..xl → the design spacing tokens).
export const LEADGEN_GAP_TOKENS = ["xs", "s", "m", "l", "xl"] as const;
export type LeadgenGapToken = (typeof LEADGEN_GAP_TOKENS)[number];

export const LEADGEN_STACK_DIRECTIONS = ["vertical", "horizontal"] as const;
export const LEADGEN_STACK_ALIGNS = ["start", "center", "end", "stretch"] as const;
export const LEADGEN_GRID_SIZINGS = ["auto", "equal"] as const;
export const LEADGEN_COLUMN_RATIOS = ["50/50", "60/40", "40/60", "70/30"] as const;
export const LEADGEN_COLUMN_MOBILE_MODES = ["stack", "keep"] as const;
export const LEADGEN_PANEL_WIDTHS = ["s", "m", "l", "full"] as const;
export const LEADGEN_PANEL_BACKGROUNDS = ["card", "wash", "ghost", "transparent"] as const;
export const LEADGEN_PANEL_SHADOWS = ["none", "sm", "md", "lg", "xl"] as const;
export const LEADGEN_PANEL_RADII = ["sm", "md", "lg", "xl"] as const;
export const LEADGEN_PANEL_PADDINGS = ["s", "m", "l"] as const;
export const LEADGEN_BG_PANEL_BACKGROUNDS = ["card", "wash", "ghost", "page", "primary"] as const;
export const LEADGEN_BG_PANEL_GRADIENTS = ["primary", "accent", "wash"] as const;

const GAP_SET: ReadonlySet<string> = new Set(LEADGEN_GAP_TOKENS);

// A safe, non-executable link target for HeaderBar cta / FooterBar links:
// absolute http(s), site-relative path (NOT protocol-relative //), fragment,
// tel: or mailto:. Anything else (javascript:, data:, //host) is rejected.
const SAFE_HREF_RE = /^(https?:\/\/|\/(?!\/)|#|tel:|mailto:)/i;

interface EnumPropSpec {
  kind: "enum";
  values: readonly string[];
}
interface IntPropSpec {
  kind: "int";
  min: number;
  max: number;
}
interface StringPropSpec {
  kind: "string";
}
interface BooleanPropSpec {
  kind: "boolean";
}
type ContainerPropSpec = EnumPropSpec | IntPropSpec | StringPropSpec | BooleanPropSpec;

const enumSpec = (values: readonly string[]): EnumPropSpec => ({ kind: "enum", values });
const intSpec = (min: number, max: number): IntPropSpec => ({ kind: "int", min, max });

// The per-type §8.5 prop tables (containers + the 3 layout leaves). cta /
// trustMessages / links have structured shapes checked by dedicated logic in
// validateContainerProps (not expressible as a scalar spec).
const CONTAINER_PROP_SPECS: Record<string, Record<string, ContainerPropSpec>> = {
  Stack: {
    direction: enumSpec(LEADGEN_STACK_DIRECTIONS),
    gap: enumSpec(LEADGEN_GAP_TOKENS),
    align: enumSpec(LEADGEN_STACK_ALIGNS),
  },
  GridContainer: {
    columnsDesktop: intSpec(2, 5),
    columnsTablet: intSpec(1, 4),
    columnsMobile: intSpec(1, 2),
    gap: enumSpec(LEADGEN_GAP_TOKENS),
    sizing: enumSpec(LEADGEN_GRID_SIZINGS),
  },
  Columns: {
    ratio: enumSpec(LEADGEN_COLUMN_RATIOS),
    mobile: enumSpec(LEADGEN_COLUMN_MOBILE_MODES),
  },
  CardPanel: {
    width: enumSpec(LEADGEN_PANEL_WIDTHS),
    background: enumSpec(LEADGEN_PANEL_BACKGROUNDS),
    shadow: enumSpec(LEADGEN_PANEL_SHADOWS),
    radius: enumSpec(LEADGEN_PANEL_RADII),
    padding: enumSpec(LEADGEN_PANEL_PADDINGS),
  },
  BackgroundPanel: {
    background: enumSpec(LEADGEN_BG_PANEL_BACKGROUNDS),
    gradient: enumSpec(LEADGEN_BG_PANEL_GRADIENTS),
    imageMediaId: { kind: "string" },
  },
  Spacer: {
    size: enumSpec(LEADGEN_GAP_TOKENS),
  },
  HeaderBar: {
    logoMediaId: { kind: "string" },
    logoAlt: { kind: "string" },
    back: { kind: "boolean" },
    backLabel: { kind: "string" },
    secure: { kind: "boolean" },
    secureText: { kind: "string" },
    // cta: structured — dedicated check below.
  },
  FooterBar: {
    legalHtml: { kind: "string" },
    // trustMessages / links: structured — dedicated checks below.
  },
};

// §8.5 token-enum validation for a container/layout-leaf node's props. Every
// prop is optional; a PRESENT prop must satisfy its spec — a violation is the
// typed `container_prop_invalid` (path components[i].props.<key>).
function validateContainerProps(
  type: string,
  props: Record<string, unknown>,
  base: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  const specs = CONTAINER_PROP_SPECS[type] ?? {};
  for (const [key, spec] of Object.entries(specs)) {
    const value = props[key];
    if (value === undefined) continue;
    const path = `${base}.props.${key}`;
    if (spec.kind === "enum") {
      if (typeof value !== "string" || !spec.values.includes(value)) {
        push(
          "container_prop_invalid",
          path,
          `${type} props.${key} must be one of ${spec.values.join("|")} (§8.5 token enum)`,
        );
      }
    } else if (spec.kind === "int") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < spec.min ||
        value > spec.max
      ) {
        push(
          "container_prop_invalid",
          path,
          `${type} props.${key} must be an integer between ${spec.min} and ${spec.max} (§8.5)`,
        );
      }
    } else if (spec.kind === "string") {
      if (typeof value !== "string" || value.trim() === "") {
        push("container_prop_invalid", path, `${type} props.${key} must be a non-empty string`);
      }
    } else if (spec.kind === "boolean") {
      if (typeof value !== "boolean") {
        push("container_prop_invalid", path, `${type} props.${key} must be a boolean`);
      }
    }
  }

  // HeaderBar cta {label, href|tel} (§8.5 "optional CTA (label + tel/href)").
  if (type === "HeaderBar" && props["cta"] !== undefined) {
    const path = `${base}.props.cta`;
    const cta = props["cta"];
    if (!isRecord(cta)) {
      push("container_prop_invalid", path, "HeaderBar props.cta must be an object {label, href|tel}");
    } else {
      if (!isNonEmptyString(cta["label"])) {
        push("container_prop_invalid", `${path}.label`, "HeaderBar cta.label is required");
      }
      const href = cta["href"];
      const tel = cta["tel"];
      if (!isNonEmptyString(href) && !isNonEmptyString(tel)) {
        push("container_prop_invalid", path, "HeaderBar cta requires href or tel");
      }
      if (isNonEmptyString(href) && !SAFE_HREF_RE.test(href.trim())) {
        push(
          "container_prop_invalid",
          `${path}.href`,
          "HeaderBar cta.href must be http(s)/relative/#/tel:/mailto:",
        );
      }
    }
  }

  // FooterBar trustMessages[] (strings) + links[{label, href}] (§8.5).
  if (type === "FooterBar") {
    if (props["trustMessages"] !== undefined) {
      const path = `${base}.props.trustMessages`;
      const raw = props["trustMessages"];
      if (!Array.isArray(raw) || !raw.every((m) => typeof m === "string")) {
        push("container_prop_invalid", path, "FooterBar props.trustMessages must be an array of strings");
      }
    }
    if (props["links"] !== undefined) {
      const raw = props["links"];
      if (!Array.isArray(raw)) {
        push("container_prop_invalid", `${base}.props.links`, "FooterBar props.links must be an array");
      } else {
        raw.forEach((link, li) => {
          const path = `${base}.props.links[${li}]`;
          if (!isRecord(link)) {
            push("container_prop_invalid", path, "each FooterBar link must be an object {label, href}");
            return;
          }
          if (!isNonEmptyString(link["label"])) {
            push("container_prop_invalid", `${path}.label`, "FooterBar link.label is required");
          }
          const href = link["href"];
          if (!isNonEmptyString(href)) {
            push("container_prop_invalid", `${path}.href`, "FooterBar link.href is required");
          } else if (!SAFE_HREF_RE.test(href.trim())) {
            push(
              "container_prop_invalid",
              `${path}.href`,
              "FooterBar link.href must be http(s)/relative/#/tel:/mailto:",
            );
          }
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// helpers (listicles validation idiom)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isChoicePrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

// A design-override VALUE must be a fixed token/scalar, never a CSS string.
// Reject anything carrying CSS-injection punctuation OR the HTML-attribute
// breakout quotes (" ' `) so a value can never escape an inline style="…"
// attribute even if it reaches a renderer (§14.10 no-arbitrary-CSS). This
// regex MUST stay byte-identical to the copy in src/leadgen/sections.ts.
const CSS_ESCAPE_RE = /[;{}<>()"'`\\]|url\(|expression|@import|\/\*/i;
function looksLikeArbitraryCss(value: unknown): boolean {
  return typeof value === "string" && CSS_ESCAPE_RE.test(value);
}

function isKnownComponentType(type: unknown): type is ComponentType {
  return typeof type === "string" && Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, type);
}

// ---------------------------------------------------------------------------
// validateSectionContent
// ---------------------------------------------------------------------------

// Validate a Section's parsed `content_json`. Pure; returns every problem
// found (never throws). `ok` is true iff `errors` is empty.
//
// §8.5 tree shape: the walk is RECURSIVE over container children with the
// SAME per-node checks at every level; nested paths follow the
// `components[i].children[j].…` convention. Uniqueness (question_id /
// question_key / internal_field) and the conditional known-field universe
// span the WHOLE tree (containers' own question_ids included). A flat array
// (zero containers) takes exactly the pre-§8.5 code path node-for-node.
export function validateSectionContent(content: unknown): SectionContentValidation {
  const errors: SectionContentError[] = [];
  const warnings: SectionContentError[] = [];
  const push = (code: SectionContentErrorCode, path: string, message: string): void => {
    errors.push({ code, path, message });
  };
  // §8.6 warnings channel: same {code, path, message} shape, NEVER affects `ok`.
  const warn = (code: SectionContentErrorCode, path: string, message: string): void => {
    warnings.push({ code, path, message });
  };

  if (!isRecord(content)) {
    push("content_not_object", "content", "content_json must be a JSON object");
    return { ok: false, errors, warnings };
  }
  const rawComponents = content["components"];
  if (!Array.isArray(rawComponents)) {
    push("components_not_array", "components", "content_json.components must be an array");
    return { ok: false, errors, warnings };
  }
  if (rawComponents.length === 0) {
    push("components_empty", "components", "a Section requires at least one component");
    return { ok: false, errors, warnings };
  }

  // Pass 1: collect the known-field universe (internal_field / question_key /
  // question_id) ACROSS THE WHOLE TREE so conditionals can be checked against
  // it order- and level-independently (§8.5: a conditional may reference a
  // field defined inside a sibling container). Depth-capped like every other
  // walk (terminates on cyclic non-JSON input).
  const knownFields = new Set<string>();
  const collectKnownFields = (nodes: readonly unknown[], depth: number): void => {
    for (const raw of nodes) {
      if (!isRecord(raw)) continue;
      for (const key of ["internal_field", "question_key", "question_id"] as const) {
        const v = raw[key];
        if (isNonEmptyString(v)) knownFields.add(v);
      }
      if (
        isLayoutContainerType(raw["type"]) &&
        depth <= LEADGEN_MAX_CONTAINER_DEPTH &&
        Array.isArray(raw["children"])
      ) {
        collectKnownFields(raw["children"], depth + 1);
      }
    }
  };
  collectKnownFields(rawComponents, 1);

  const seenQuestionIds = new Set<string>();
  const seenQuestionKeys = new Set<string>();
  const seenInternalFields = new Set<string>();
  // §3.4: each bind VALUE may be claimed at most once per Section, whole tree.
  const seenBinds = new Set<string>();
  // 11 §11.5: ContinueButton nodes counted across the whole tree (warning).
  let continueCount = 0;

  // Pass 2: per-node validation, recursive over container children.
  const validateNode = (raw: unknown, base: string, depth: number): void => {
    if (!isRecord(raw)) {
      push("node_not_object", base, "each component must be a JSON object");
      return;
    }

    // type ∈ catalog (registry closing contract: a component NOT in the
    // catalog cannot be placed).
    const type = raw["type"];
    if (!isKnownComponentType(type)) {
      push(
        "unknown_component_type",
        `${base}.type`,
        `unknown component type ${JSON.stringify(type)} — not in the component catalog`,
      );
      return; // no further per-type checks possible without a known type
    }
    const spec = REQUIRED_FIELDS[type];
    const catalog = COMPONENT_CATALOG[type];
    const isContainer = isLayoutContainerType(type);

    // question_id: required + unique across the whole tree.
    const questionId = raw["question_id"];
    if (!isNonEmptyString(questionId)) {
      push("missing_question_id", `${base}.question_id`, "question_id is required (stable id)");
    } else if (seenQuestionIds.has(questionId)) {
      push("duplicate_question_id", `${base}.question_id`, `duplicate question_id '${questionId}'`);
    } else {
      seenQuestionIds.add(questionId);
    }

    // question_key: unique when present (whole tree).
    const questionKey = raw["question_key"];
    if (questionKey !== undefined) {
      if (!isNonEmptyString(questionKey)) {
        push("missing_required_field", `${base}.question_key`, "question_key must be a non-empty string");
      } else if (seenQuestionKeys.has(questionKey)) {
        push("duplicate_question_key", `${base}.question_key`, `duplicate question_key '${questionKey}'`);
      } else {
        seenQuestionKeys.add(questionKey);
      }
    }

    const props = isRecord(raw["props"]) ? raw["props"] : {};

    // §3.5/§8.2 frame-scope component inside a Section: legal in stored
    // content (legacy renders unchanged) — path-precise save-time WARNING,
    // never a blocking error here. Applies at every tree level (HeaderBar /
    // FooterBar layout leaves, the BackgroundPanel container, chrome types).
    if (catalog.scope === "frame") {
      warn(
        "frame_scope_component",
        base,
        `${type} is a funnel-frame component (§8.2 scope "frame") — it belongs to the Quote frame, not a Section unit`,
      );
    }

    // 11 §11.5 duplicate Continue buttons: the SECOND+ ContinueButton anywhere
    // in the tree gets a path-precise save-time WARNING (§11.5 mandates the
    // save-time surface; only the first Continue renders/wires). `ok` is
    // unaffected. The activation-PREFLIGHT row stays frame-gated per 14 §14.4
    // (activating untouched legacy quotes yields zero new problems) — a SAVE
    // is an operator action on this Section, so warning here is
    // §14.4-compatible.
    if (type === "ContinueButton") {
      continueCount += 1;
      if (continueCount > 1) {
        warn(
          "duplicate_continue",
          base,
          "this Section has more than one Continue button — only the first is shown (§11.5)",
        );
      }
    }

    // §3.4 canonical headline binding. Checked for EVERY known-typed node
    // (a container claiming a bind is a type mismatch like any other node).
    const bindRaw = raw["bind"];
    let boundHere = false; // valid bind on the matching type → props.text is Section-column-resolved
    if (bindRaw !== undefined) {
      if (typeof bindRaw !== "string" || !BIND_SET.has(bindRaw)) {
        push(
          "bind_type_mismatch",
          `${base}.bind`,
          `bind must be one of ${LEADGEN_COMPONENT_BINDS.join("|")} (§3.4)`,
        );
      } else {
        const bind = bindRaw as LeadgenComponentBind;
        const expected = BIND_EXPECTED_TYPE[bind];
        if (seenBinds.has(bind)) {
          push(
            "duplicate_bind",
            `${base}.bind`,
            `duplicate bind '${bind}' — at most one node per bind value per Section (§3.4)`,
          );
        } else {
          seenBinds.add(bind);
        }
        if (type !== expected) {
          push(
            "bind_type_mismatch",
            `${base}.bind`,
            `bind '${bind}' is only legal on type ${expected} (§3.4)`,
          );
        } else {
          boundHere = true;
          if (props["text"] !== undefined) {
            push(
              "bound_node_carries_text",
              `${base}.props.text`,
              `a bound ${type} must not carry props.text — its text is the Section column, resolved at render (§3.4)`,
            );
          }
        }
      }
    }

    if (isContainer) {
      // §8.5 container node: depth cap, no answer fields, token-enum props,
      // recursive children. Depth counts CONTAINER nesting levels (root = 1);
      // past the cap we stop descending — which also terminates any cyclic
      // (non-JSON) object graph ("containers cannot contain themselves").
      if (depth > LEADGEN_MAX_CONTAINER_DEPTH) {
        push(
          "container_depth_exceeded",
          base,
          `container nesting exceeds the §8.5 maximum depth of ${LEADGEN_MAX_CONTAINER_DEPTH}`,
        );
        return;
      }

      // Containers carry NO answer fields (§8.5): they produce nothing.
      for (const key of ["internal_field", "choices", "answer_type"] as const) {
        if (raw[key] !== undefined) {
          push(
            "container_answer_field_forbidden",
            `${base}.${key}`,
            `${type} is a layout container — ${key} is not allowed on it (§8.5)`,
          );
        }
      }

      // Token-enum props (§8.5 table) — typed container_prop_invalid.
      validateContainerProps(type, props, base, push);

      // conditional on a container: validated for SHAPE + known field like
      // any node (harmless if authored; visibility logic runs on the
      // flattened leaves, so it has no runtime effect today).
      if (raw["conditional"] !== undefined) {
        validateConditional(raw["conditional"], `${base}.conditional`, knownFields, push);
      }

      // children: optional; when present must be an array; each child is
      // validated with the SAME rules at depth + 1 under the
      // `components[i].children[j]` path convention.
      const children = raw["children"];
      if (children !== undefined) {
        if (!Array.isArray(children)) {
          push(
            "container_prop_invalid",
            `${base}.children`,
            `${type} children must be an array of component nodes`,
          );
        } else {
          for (let j = 0; j < children.length; j++) {
            validateNode(children[j], `${base}.children[${j}]`, depth + 1);
          }
        }
      }
      return;
    }

    // Non-container node: children are forbidden (§8.5 "children only on the
    // 5 container types").
    if (raw["children"] !== undefined) {
      push(
        "children_not_allowed",
        `${base}.children`,
        `${type} is not a layout container — children are not allowed on it (§8.5)`,
      );
    }

    // §8.5 layout LEAVES (Spacer / HeaderBar / FooterBar): their structured
    // props are token-enum validated exactly like container props.
    if (Object.prototype.hasOwnProperty.call(CONTAINER_PROP_SPECS, type)) {
      validateContainerProps(type, props, base, push);
    }

    // internal_field: unique across the whole tree when present — scoped to
    // ANSWER-PRODUCING components only (§8.5 "QUESTION components must remain
    // unique by internal_field"). Non-producing nodes (ValidationError,
    // HelperText, …) legitimately REFERENCE a question's internal_field —
    // e.g. a ValidationError carries it as the error-slot binding
    // (data-lg-error-for) — without claiming the answer name, so they never
    // join (or collide with) the uniqueness universe.
    const internalField = raw["internal_field"];
    if (isNonEmptyString(internalField) && catalog.produces !== null) {
      if (seenInternalFields.has(internalField)) {
        push(
          "duplicate_internal_field",
          `${base}.internal_field`,
          `duplicate internal_field '${internalField}' (§8.5 unique across the Section)`,
        );
      } else {
        seenInternalFields.add(internalField);
      }
    }

    // required authorable fields per the catalog entry.
    if (spec.internalField === true && !isNonEmptyString(raw["internal_field"])) {
      push(
        "missing_required_field",
        `${base}.internal_field`,
        `${type} requires internal_field (normalized answer name)`,
      );
    }
    for (const key of spec.textProps ?? []) {
      // §3.4: a BOUND QuestionHeadline/Subheadline must NOT carry props.text —
      // its text is the Section headline/subheadline column, so the legacy
      // required-text rule is waived for it (presence is the error instead).
      if (boundHere && key === "text") continue;
      if (!isNonEmptyString(props[key])) {
        push("missing_required_field", `${base}.props.${key}`, `${type} requires props.${key}`);
      }
    }
    for (const key of spec.numericProps ?? []) {
      if (typeof props[key] !== "number" || !Number.isFinite(props[key])) {
        push("missing_required_field", `${base}.props.${key}`, `${type} requires numeric props.${key}`);
      }
    }

    // choices (§13.1 per-choice value/analytics_id; §14.4 per-choice icon).
    if (spec.choices === true) {
      const choices = raw["choices"];
      if (!Array.isArray(choices) || choices.length === 0) {
        push("invalid_choice", `${base}.choices`, `${type} requires a non-empty choices array`);
      } else {
        for (let c = 0; c < choices.length; c++) {
          const cp = `${base}.choices[${c}]`;
          const choice = choices[c];
          if (!isRecord(choice)) {
            push("invalid_choice", cp, "each choice must be an object");
            continue;
          }
          if (!isNonEmptyString(choice["label"])) {
            push("invalid_choice", `${cp}.label`, "choice.label is required");
          }
          if (!isChoicePrimitive(choice["value"])) {
            push("invalid_choice", `${cp}.value`, "choice.value must be a string, number, or boolean");
          }
          if (!isNonEmptyString(choice["analytics_id"])) {
            push("invalid_choice", `${cp}.analytics_id`, "choice.analytics_id is required (§22 tracking)");
          }
          if (spec.choiceIcon === true && !isNonEmptyString(choice["icon"])) {
            push("invalid_choice", `${cp}.icon`, `${type} requires a per-choice icon (§14.4)`);
          }
          if (spec.choiceImage === true && !isNonEmptyString(choice["imageMediaId"])) {
            push("invalid_choice", `${cp}.imageMediaId`, `${type} requires a per-choice imageMediaId`);
          }
          // v2.5 §8.4 additive per-choice fields — typed when present.
          for (const key of ["title", "subtitle", "badge", "emoji", "image_alt", "aria_label"] as const) {
            if (choice[key] !== undefined && typeof choice[key] !== "string") {
              push("invalid_choice", `${cp}.${key}`, `choice.${key} must be a string (§8.4)`);
            }
          }
          if (choice["disabled"] !== undefined && typeof choice["disabled"] !== "boolean") {
            push("invalid_choice", `${cp}.disabled`, "choice.disabled must be a boolean (§8.4)");
          }
          // §8.4: emoji and icon are mutually exclusive per choice.
          if (isNonEmptyString(choice["emoji"]) && isNonEmptyString(choice["icon"])) {
            push(
              "invalid_choice",
              `${cp}.emoji`,
              "choice.emoji and choice.icon are mutually exclusive (§8.4)",
            );
          }
          // §8.4: image_alt is REQUIRED when imageMediaId is present on an
          // ImageCardAnswerGrid choice (accessible name for the image card).
          if (
            type === "ImageCardAnswerGrid" &&
            isNonEmptyString(choice["imageMediaId"]) &&
            !isNonEmptyString(choice["image_alt"])
          ) {
            push(
              "invalid_choice",
              `${cp}.image_alt`,
              "image_alt is required when imageMediaId is present (§8.4)",
            );
          }
        }
      }
    }

    // valid_values (enum-like domain) when present: non-empty primitive array.
    if (raw["valid_values"] !== undefined) {
      const vv = raw["valid_values"];
      if (!Array.isArray(vv) || vv.length === 0 || !vv.every(isChoicePrimitive)) {
        push(
          "invalid_valid_values",
          `${base}.valid_values`,
          "valid_values must be a non-empty array of primitives",
        );
      }
    }

    // answer_type must agree with the catalog `produces` (when it emits one).
    const answerType = raw["answer_type"];
    if (answerType !== undefined && catalog.produces !== null && answerType !== catalog.produces) {
      push(
        "answer_type_mismatch",
        `${base}.answer_type`,
        `answer_type '${String(answerType)}' does not match catalog produces '${catalog.produces}'`,
      );
    }

    // conditional (§12.3): shape + referenced field must exist in the Section.
    if (raw["conditional"] !== undefined) {
      validateConditional(raw["conditional"], `${base}.conditional`, knownFields, push);
    }

    // B9 §6.4 mirrored choiceDisplay (Phase-2 authoring leg): typed shape,
    // known keys only, mainValues ⊆ the node's authored choice values. The
    // render leg (readChoiceDisplay) stays defensive — this validation stops
    // author mistakes at save.
    if (raw["choiceDisplay"] !== undefined) {
      validateChoiceDisplayMirror(raw["choiceDisplay"], raw["choices"], `${base}.choiceDisplay`, push);
    }

    // design_overrides: curated keys only; token/scalar values, never CSS.
    if (raw["design_overrides"] !== undefined) {
      const overrides = raw["design_overrides"];
      if (!isRecord(overrides)) {
        push(
          "non_curated_override_key",
          `${base}.design_overrides`,
          "design_overrides must be an object of curated token keys",
        );
      } else {
        for (const [key, value] of Object.entries(overrides)) {
          if (!CURATED_OVERRIDE_KEY_SET.has(key)) {
            push(
              "non_curated_override_key",
              `${base}.design_overrides.${key}`,
              `'${key}' is not a curated design-override token key (§14.8)`,
            );
          } else if (looksLikeArbitraryCss(value)) {
            push(
              "arbitrary_css_override",
              `${base}.design_overrides.${key}`,
              `design_overrides.${key} must be a fixed token value, not arbitrary CSS (§14.10)`,
            );
          } else if (COLOR_TYPED_KEY_SET.has(key) && !isValidColorOverrideValue(value)) {
            // v2.5 §9.4: a color-typed override VALUE must be a known theme
            // role (09 §9.1) or a legacy raw `#hex` literal (tolerated —
            // existing stored content). Never any other string/scalar.
            push(
              "invalid_override_value",
              `${base}.design_overrides.${key}`,
              `design_overrides.${key} must be a theme color role (${LEADGEN_THEME_ROLES.join(", ")}) or a legacy #hex literal (§9.4)`,
            );
          }
        }
      }
    }
  };

  for (let i = 0; i < rawComponents.length; i++) {
    validateNode(rawComponents[i], `components[${i}]`, 1);
  }

  // §8.6: `ok` is keyed to ERRORS only — warnings never block a save.
  return { ok: errors.length === 0, errors, warnings };
}

// B9 §6.4 mirrored-choiceDisplay check (mirrors payload.ts
// validateChoiceDisplay, with the Section-side domain: the node's authored
// choices — mainValues members must equal String(choice.value) of one of
// them, exactly how the render leg (presets.ts splitChoicesForOtherGroup)
// matches membership).
const CHOICE_DISPLAY_KEYS = [
  "mainValues",
  "otherGroupEnabled",
  "otherGroupLabel",
  "searchableOther",
] as const;
const CHOICE_DISPLAY_KEY_SET: ReadonlySet<string> = new Set(CHOICE_DISPLAY_KEYS);

function validateChoiceDisplayMirror(
  raw: unknown,
  rawChoices: unknown,
  path: string,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(raw)) {
    push("choice_display_invalid", path, "choiceDisplay must be an object");
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!CHOICE_DISPLAY_KEY_SET.has(key)) {
      push(
        "choice_display_invalid",
        `${path}.${key}`,
        `unknown choiceDisplay key '${key}' (allowed: ${CHOICE_DISPLAY_KEYS.join(", ")})`,
      );
    }
  }
  const choiceValues = new Set<string>();
  const hasChoices = Array.isArray(rawChoices) && rawChoices.length > 0;
  if (hasChoices) {
    for (const choice of rawChoices) {
      if (isRecord(choice) && isChoicePrimitive(choice["value"])) {
        choiceValues.add(String(choice["value"]));
      }
    }
  } else {
    push(
      "choice_display_invalid",
      path,
      "choiceDisplay requires an authorable choices list on the same component",
    );
  }
  const mainValues = raw["mainValues"];
  if (mainValues !== undefined) {
    if (!Array.isArray(mainValues)) {
      push("choice_display_invalid", `${path}.mainValues`, "mainValues must be an array of strings");
    } else {
      const nonStrings = mainValues.filter((v) => typeof v !== "string");
      if (nonStrings.length > 0) {
        push(
          "choice_display_invalid",
          `${path}.mainValues`,
          `mainValues must be strings (offenders: ${nonStrings.map((v) => JSON.stringify(v)).join(", ")})`,
        );
      }
      if (hasChoices) {
        const offenders = mainValues.filter(
          (v): v is string => typeof v === "string" && !choiceValues.has(v),
        );
        if (offenders.length > 0) {
          push(
            "choice_display_invalid",
            `${path}.mainValues`,
            `mainValues not among this component's choice values: ${offenders.join(", ")}`,
          );
        }
      }
    }
  }
  for (const key of ["otherGroupEnabled", "searchableOther"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      push("choice_display_invalid", `${path}.${key}`, `choiceDisplay.${key} must be a boolean`);
    }
  }
  if (raw["otherGroupLabel"] !== undefined && typeof raw["otherGroupLabel"] !== "string") {
    push("choice_display_invalid", `${path}.otherGroupLabel`, "choiceDisplay.otherGroupLabel must be a string");
  }
}

// conditional shape check (mirrors payload.ts validateConditional) + the
// content-specific rule that `when` must reference a field that EXISTS in the
// Section (else the dependency can never fire).
function validateConditional(
  raw: unknown,
  path: string,
  knownFields: ReadonlySet<string>,
  push: (code: SectionContentErrorCode, path: string, message: string) => void,
): void {
  if (!isRecord(raw)) {
    push("conditional_invalid", path, "conditional must be an object {when, op, value}");
    return;
  }
  const when = raw["when"];
  if (!isNonEmptyString(when)) {
    push("conditional_invalid", `${path}.when`, "conditional.when is required");
  } else if (!knownFields.has(when)) {
    push(
      "conditional_unknown_field",
      `${path}.when`,
      `conditional.when '${when}' references a field not present in this Section`,
    );
  }
  const op = raw["op"];
  if (typeof op !== "string" || !CONDITION_OPS.has(op)) {
    push(
      "conditional_invalid",
      `${path}.op`,
      `conditional.op must be one of ${[...CONDITION_OPS].join("|")}`,
    );
    return;
  }
  if (op === "range" && (typeof raw["from"] !== "number" || typeof raw["to"] !== "number")) {
    push("conditional_invalid", path, "range conditional requires numeric from + to");
  }
  if ((op === "in" || op === "not_in") && !Array.isArray(raw["values"])) {
    push("conditional_invalid", path, `${op} conditional requires a values array`);
  }
}
