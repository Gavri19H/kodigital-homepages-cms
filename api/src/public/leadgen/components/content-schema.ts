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
export interface LeadgenChoice {
  label: string;
  value: string | number | boolean;
  analytics_id: string;
  icon?: string;
  description?: string;
  imageMediaId?: string;
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

// One component node in a Section's `content_json`.
export interface LeadgenComponentNode {
  type: ComponentType;
  question_id: string;
  question_key?: string;
  internal_field?: string;
  answer_type?: LeadgenAnswerType;
  required?: boolean;
  valid_values?: Array<string | number | boolean>;
  choices?: LeadgenChoice[];
  conditional?: LeadgenComponentConditional;
  design_preset?: string;
  design_overrides?: LeadgenDesignOverrides;
  // Per-type authorable extras (min/max/step/labels/placeholder/text/html/
  // logoMediaId/columns/…). Preset-specific; presets read them defensively.
  props?: Record<string, unknown>;
}

export interface LeadgenSectionContent {
  components: LeadgenComponentNode[];
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
  | "missing_required_field"
  | "invalid_choice"
  | "invalid_valid_values"
  | "answer_type_mismatch"
  | "conditional_invalid"
  | "conditional_unknown_field"
  | "non_curated_override_key"
  | "arbitrary_css_override";

export interface SectionContentError {
  code: SectionContentErrorCode;
  path: string;
  message: string;
}

export interface SectionContentValidation {
  ok: boolean;
  errors: SectionContentError[];
}

// ---------------------------------------------------------------------------
// Required-field table (derived from the catalog `props` contract). A prop
// listed WITHOUT a trailing `?` in components/registry.ts is required; this
// table is the curated, exhaustive resolution of that contract per type
// (with the `...RangeQuestion` spread resolved). A new ComponentType added to
// the catalog forces a new row here (compile error otherwise) — keeping the
// content contract and the capability catalog in lockstep.
// ---------------------------------------------------------------------------

interface RequiredSpec {
  internalField?: boolean; // catalog props include "internal_field"
  choices?: boolean; // catalog props include a "choices…" token
  choiceIcon?: boolean; // §14.4: each choice needs an icon
  choiceImage?: boolean; // catalog choices[{imageMediaId,…}]
  textProps?: readonly string[]; // simple required scalar props (in node.props)
  numericProps?: readonly string[]; // required numeric props (in node.props)
}

const REQUIRED_FIELDS: Record<ComponentType, RequiredSpec> = {
  // chrome
  ProgressBar: {},
  HeaderLogo: { textProps: ["logoMediaId"] },
  BackButton: {},
  DisclosureLink: { textProps: ["panelHtml"] },
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
  // free-form + PII inputs
  FreeTextQuestion: { internalField: true },
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
  HelperText: { textProps: ["text"] },
  ValidationError: {},
  LegalNote: { textProps: ["html"] },
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
// Reject anything carrying CSS-injection punctuation (§14.10 no-arbitrary-CSS).
const CSS_ESCAPE_RE = /[;{}<>()\\]|url\(|expression|@import|\/\*/i;
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
export function validateSectionContent(content: unknown): SectionContentValidation {
  const errors: SectionContentError[] = [];
  const push = (code: SectionContentErrorCode, path: string, message: string): void => {
    errors.push({ code, path, message });
  };

  if (!isRecord(content)) {
    push("content_not_object", "content", "content_json must be a JSON object");
    return { ok: false, errors };
  }
  const rawComponents = content["components"];
  if (!Array.isArray(rawComponents)) {
    push("components_not_array", "components", "content_json.components must be an array");
    return { ok: false, errors };
  }
  if (rawComponents.length === 0) {
    push("components_empty", "components", "a Section requires at least one component");
    return { ok: false, errors };
  }

  // Pass 1: collect the known-field universe (internal_field / question_key /
  // question_id) so conditionals can be checked against it order-independently.
  const knownFields = new Set<string>();
  for (const raw of rawComponents) {
    if (!isRecord(raw)) continue;
    for (const key of ["internal_field", "question_key", "question_id"] as const) {
      const v = raw[key];
      if (isNonEmptyString(v)) knownFields.add(v);
    }
  }

  const seenQuestionIds = new Set<string>();
  const seenQuestionKeys = new Set<string>();

  // Pass 2: per-node validation.
  for (let i = 0; i < rawComponents.length; i++) {
    const base = `components[${i}]`;
    const raw = rawComponents[i];
    if (!isRecord(raw)) {
      push("node_not_object", base, "each component must be a JSON object");
      continue;
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
      continue; // no further per-type checks possible without a known type
    }
    const spec = REQUIRED_FIELDS[type];
    const catalog = COMPONENT_CATALOG[type];

    // question_id: required + unique.
    const questionId = raw["question_id"];
    if (!isNonEmptyString(questionId)) {
      push("missing_question_id", `${base}.question_id`, "question_id is required (stable id)");
    } else if (seenQuestionIds.has(questionId)) {
      push("duplicate_question_id", `${base}.question_id`, `duplicate question_id '${questionId}'`);
    } else {
      seenQuestionIds.add(questionId);
    }

    // question_key: unique when present.
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

    // required authorable fields per the catalog entry.
    if (spec.internalField === true && !isNonEmptyString(raw["internal_field"])) {
      push(
        "missing_required_field",
        `${base}.internal_field`,
        `${type} requires internal_field (normalized answer name)`,
      );
    }
    const props = isRecord(raw["props"]) ? raw["props"] : {};
    for (const key of spec.textProps ?? []) {
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
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
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
