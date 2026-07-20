// LeadGen dynamic payload builder — schema types, validation, runtime build,
// cleanObject, transforms, and infer-from-example (contract 04 §11 + 05
// §12.7 normalization pipeline).
//
// The persisted `leadgen_offer_payload_schemas.schema_json` shape is the 04
// §11.5 NORMATIVE shape: `{ version, root: { type:"object", children:[...] } }`
// where `children` is a FLAT list of nodes whose dotted `path` values imply
// the nesting (the normative example nests `data.home_own` purely through
// its path — there are no nested `children` arrays below root). Numeric
// path segments address array elements (`drivers.0.age`), which is how the
// reference's array collection (01 §2.3) maps onto the flat node list.
//
// Runtime build order per 04 §11.5 + 05 §12.7 ("Normalization pipeline
// order"): resolve each node by `source` (answer via internal_field +
// value_map + transform pipeline; static; computed; macro; placement —
// fix-contract v2.4 04 §4.5 offer/auction placement id; token), coerce to
// the node's declared type, apply default (absent) / fallback (invalid),
// drop nodes whose `conditional` is unmet, then `cleanObject` — the "no
// fabrication" rule: the payload never invents empty values.
//
// The transform set is the NORMATIVE pipeline from contract 05 §12
// (`value_transform` row of the answer-map field table): mapBoolean,
// mapEnum(map), formatDate(fmt), formatPhone, toNumber, toString, trim.

import type {
  LeadgenApiTokenPlacement,
  LeadgenConditionOp,
  LeadgenRequestExecutionMode,
} from "../admin/leadgen/db-types";
import { isLeadgenComputedKey, LEADGEN_COMPUTED_KEYS } from "./computed";
import { isCanonicalMacro } from "./macros";

// ---------------------------------------------------------------------------
// Schema types (04 §11.5 normative shape + §11.1 builder field inventory)
// ---------------------------------------------------------------------------

export const LEADGEN_PAYLOAD_NODE_TYPES = [
  "string",
  "number",
  "boolean",
  "enum",
  "object",
  "array",
] as const;
export type LeadgenPayloadNodeType = (typeof LEADGEN_PAYLOAD_NODE_TYPES)[number];

// The v2.4 canonical source enum (fix-contract 04 §4.5): `placement` is the
// discoverable "Offer / Auction → Placement ID" source — a backward-
// compatible storage extension over the original five.
export const LEADGEN_PAYLOAD_SOURCES = [
  "answer",
  "static",
  "computed",
  "macro",
  "placement",
  "token",
] as const;
export type LeadgenPayloadSource = (typeof LEADGEN_PAYLOAD_SOURCES)[number];

// §6.5 free-text pattern presets (B12) — the optional-constraint enum for
// free-text string answer nodes. "none" = sanitize only (no pattern check);
// "custom" requires free_text_pattern_custom.
export const LEADGEN_FREE_TEXT_PATTERNS = ["none", "letters", "digits", "custom"] as const;
export type LeadgenFreeTextPattern = (typeof LEADGEN_FREE_TEXT_PATTERNS)[number];

// B9 Other-group display metadata (fix-contract v2.4 06 §6.4) — ADDITIVE,
// stored on `source:"answer"` nodes only. buildPayload NEVER consumes it
// (payload bytes are unaffected); the render leg is Phase 1's
// `readChoiceDisplay` (public/leadgen/components/presets.ts), which also
// applies the contract defaults (otherGroupLabel → "Other",
// booleans → false) — so every field here is OPTIONAL in storage and an
// existing schema without choiceDisplay re-saves byte-equivalent (§6.14).
export interface LeadgenPayloadChoiceDisplay {
  // Values shown as normal choices; everything else folds into "Other".
  // Members must live inside the node's declared value domain:
  // value_map internal keys ∪ valid_values (validated, §6.4).
  mainValues?: string[];
  otherGroupEnabled?: boolean;
  otherGroupLabel?: string; // default "Other" (applied at render, not stored)
  searchableOther?: boolean;
}

// Conditional show/hide (04 §11.1 / §11.5 "drop unmet conditional"). Same
// `{when, op, value}` family the question builder stores inline (05 §12.3),
// with ops from the 07 §21.4 typed-conditions set (db-types union). `when`
// names the internal normalized answer field evaluated against ctx.answers.
export interface LeadgenPayloadConditional {
  when: string;
  op: LeadgenConditionOp;
  value?: unknown;
  values?: unknown[];
  from?: number;
  to?: number;
}

// A-4 (Round-4) composed condition group — the §21.4 AND/OR model at the
// SECTION level (ANY/ALL groups). `match:"any"` = OR (some), anything else
// (incl. "all"/absent) = AND (every); empty `conditions` follows every/some
// (all ⇒ true, any ⇒ false). Detected STRUCTURALLY by an array `conditions`
// (a bare conditional never carries one). The SINGLE money-path evaluator
// `conditionalMet` (below) dispatches on it, byte-identically to the client
// twin (public/leadgen/runtime/dependencies.ts conditionMet), so payload-build
// node-drop, the §12.3 dependency show/hide/require (dependencies.ts delegates
// here), and auction-rules eligibility can never diverge on a composed rule.
export interface LeadgenPayloadConditionGroup {
  match?: "all" | "any";
  conditions: LeadgenPayloadConditional[];
}

// The normative transform pipeline steps (05 §12, `value_transform`).
export type LeadgenTransformStep =
  | { kind: "mapBoolean" }
  | { kind: "mapEnum"; map: Record<string, unknown> }
  | { kind: "formatDate"; format: string }
  | { kind: "formatPhone" }
  | { kind: "toNumber" }
  | { kind: "toString" }
  | { kind: "trim" };

export interface LeadgenPayloadNode {
  // Dotted placement path into the built payload (`data.home_own`). Numeric
  // segments create/index arrays. Unique per schema.
  path: string;
  // The leaf JSON key — must equal the last path segment (the §11.5 example
  // holds this invariant; `label` is the free-text display name).
  name: string;
  label?: string;
  type: LeadgenPayloadNodeType;
  required?: boolean;
  // Enum domain (04 §11.1 `valid_values`) — required for type:"enum".
  valid_values?: unknown[];
  // default = value when the source is ABSENT; fallback = value when the
  // resolved value is INVALID (05 §12 default_value/fallback_value split).
  // Both are FINAL output values (applied after map/transform/coercion).
  default?: unknown;
  fallback?: unknown;
  source: LeadgenPayloadSource;
  // source:"answer" — the internal normalized field (05 §12.7 pivot) plus
  // optional per-node value_map and transform pipeline.
  internal_field?: string;
  value_map?: Record<string, unknown>;
  transform?: LeadgenTransformStep[];
  // source:"answer" — B9 §6.4 Other-group display metadata (see interface).
  choiceDisplay?: LeadgenPayloadChoiceDisplay;
  // §6.5 free-text optional constraints (B12) — ADDITIVE, valid ONLY on
  // free-text string answer nodes (source:"answer" + type:"string" + no
  // value_map + no valid_values). At runtime the resolved value is
  // sanitized (control chars stripped + trimmed) and checked; too long /
  // pattern mismatch = INVALID → the standard fallback machinery. Nodes
  // without these fields skip the leg entirely (§1.4 byte-compatibility).
  free_text_max_length?: number;
  free_text_pattern?: LeadgenFreeTextPattern;
  // pattern:"custom" only — a length-capped, bomb-screened RegExp source.
  free_text_pattern_custom?: string;
  // source:"static" — the authored literal value.
  value?: unknown;
  // source:"computed" — a COMPUTED_REGISTRY key (computed.ts) resolved into
  // ctx.computed (server-derived values).
  computed?: string;
  // source:"macro" — one of the 32 canonical macro names (macros.ts).
  macro?: string;
  // source:"placement" carries no extra field — it resolves from
  // ctx.offer.placement_id (fix-contract v2.4 04 §4.5).
  conditional?: LeadgenPayloadConditional;
}

export interface LeadgenPayloadSchema {
  version: number;
  root: { type: "object"; children: LeadgenPayloadNode[] };
}

// §6.9: `default` / `fallback` may be this TYPED object instead of a
// literal — resolved at build time from ctx.computed[key]. Discriminator:
// ANY record whose `source` property is "computed" is ref INTENT (the key
// is then validated at save); every other value stays a literal and keeps
// behaving byte-identically (§1.4 + §6.14 — legacy looseJson included).
export interface LeadgenComputedValueRef {
  source: "computed";
  key: string;
}

export function isComputedValueRef(value: unknown): value is LeadgenComputedValueRef {
  return (
    isRecord(value) && value["source"] === "computed" && typeof value["key"] === "string"
  );
}

// Ref INTENT (see above): also matches malformed refs (missing/non-string
// key) so validation can reject them instead of silently treating a typo'd
// ref as a literal object default.
function isComputedRefIntent(value: unknown): boolean {
  return isRecord(value) && value["source"] === "computed";
}

// ---------------------------------------------------------------------------
// Schema validation (04 §11.5 shape + §11.1 per-source integrity rules)
// ---------------------------------------------------------------------------

export type LeadgenPayloadSchemaErrorCode =
  | "schema_not_object"
  | "version_invalid"
  | "root_invalid"
  | "node_not_object"
  | "path_invalid"
  | "path_duplicate"
  | "path_prefix_conflict"
  | "name_invalid"
  | "name_path_mismatch"
  | "type_invalid"
  | "source_invalid"
  | "enum_valid_values_required"
  | "valid_values_invalid"
  | "enum_value_violation"
  | "answer_missing_internal_field"
  | "value_map_invalid"
  | "transform_invalid"
  | "static_missing_value"
  | "computed_missing_key"
  | "computed_unknown_key"
  | "macro_missing_name"
  | "macro_unknown"
  | "token_node_invalid"
  | "token_node_duplicate"
  | "conditional_invalid"
  | "choice_display_invalid"
  | "free_text_constraint_invalid";

export interface LeadgenPayloadSchemaError {
  code: LeadgenPayloadSchemaErrorCode;
  // Offending node path where one exists (schema-level errors omit it).
  path?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// B7 blocking vs warning classification (fix-contract v2.4 05 §5.5 + 06 §6.11)
// ---------------------------------------------------------------------------
//
// P0/P1-class (BLOCKING) codes reject a schema SAVE and stop a Test run;
// warning-class codes are advisory: the save proceeds (response carries
// `warnings[]`) and Test runs. The exported list is the single source of
// truth the §6.11 validation-panel footer documents.
//
// One-line classification per code:
//   schema_not_object            BLOCKING structural — not a JSON object; nothing can read it
//   version_invalid              BLOCKING structural — version counter must be a positive integer
//   root_invalid                 BLOCKING structural — no root.children node list to build from
//   node_not_object              BLOCKING structural — a child that is not an object cannot be a node
//   path_invalid                 BLOCKING structural — unaddressable/prototype-chain path
//   path_duplicate               BLOCKING path-conflict — two nodes claim one payload path
//   path_prefix_conflict         BLOCKING path-conflict — scalar path shadows a nested path
//   name_invalid                 BLOCKING structural — the leaf JSON key is missing
//   name_path_mismatch           BLOCKING structural — builder UI and payload would disagree on identity
//   type_invalid                 BLOCKING type — unknown output type; coercion undefined
//   source_invalid               BLOCKING unknown-source — no resolver exists for the source
//   enum_valid_values_required   BLOCKING type — an enum without a domain can never validate
//   valid_values_invalid         BLOCKING type — the declared domain is not a list
//   enum_value_violation         WARNING advisory — authored default/fallback/value escapes the declared
//                                domain; the schema still builds (runtime domain check governs)
//   answer_missing_internal_field BLOCKING structural — an answer node without its pivot cannot resolve
//   value_map_invalid            BLOCKING type — value_map must be an object to look up
//   transform_invalid            BLOCKING unknown-key — unknown/malformed transform step in the pipeline
//   static_missing_value         BLOCKING structural — a static node without a value resolves to nothing
//   computed_missing_key         BLOCKING structural — a computed node without its registry key
//   computed_unknown_key         BLOCKING unknown-key — key outside COMPUTED_REGISTRY (04 §4.4)
//   macro_missing_name           BLOCKING structural — a macro node without its macro name
//   macro_unknown                BLOCKING unknown-source — not one of the 32 canonical macros
//   token_node_invalid           BLOCKING type — token node must be a bare string leaf
//   token_node_duplicate         BLOCKING path-conflict — an Offer has exactly one token placement
//   conditional_invalid          BLOCKING type — malformed conditional would mis-drop the node
//   choice_display_invalid       WARNING advisory — §6.4 display-only metadata; payload bytes and the
//                                defensive render leg (readChoiceDisplay) are unaffected
//   free_text_constraint_invalid BLOCKING type — §6.5 free-text constraints (max length / pattern /
//                                custom regex) are malformed or ride a non-free-text node; a bad
//                                config must never reach the runtime enforcement leg

export const LEADGEN_PAYLOAD_WARNING_ERROR_CODES = [
  "enum_value_violation",
  "choice_display_invalid",
] as const satisfies readonly LeadgenPayloadSchemaErrorCode[];

export const LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES = [
  "schema_not_object",
  "version_invalid",
  "root_invalid",
  "node_not_object",
  "path_invalid",
  "path_duplicate",
  "path_prefix_conflict",
  "name_invalid",
  "name_path_mismatch",
  "type_invalid",
  "source_invalid",
  "enum_valid_values_required",
  "valid_values_invalid",
  "answer_missing_internal_field",
  "value_map_invalid",
  "transform_invalid",
  "static_missing_value",
  "computed_missing_key",
  "computed_unknown_key",
  "macro_missing_name",
  "macro_unknown",
  "token_node_invalid",
  "token_node_duplicate",
  "conditional_invalid",
  "free_text_constraint_invalid",
] as const satisfies readonly LeadgenPayloadSchemaErrorCode[];

// Compile-time exhaustiveness: adding a LeadgenPayloadSchemaErrorCode without
// classifying it blocking-or-warning breaks this line (never both/neither).
type UnclassifiedPayloadSchemaErrorCode = Exclude<
  LeadgenPayloadSchemaErrorCode,
  | (typeof LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES)[number]
  | (typeof LEADGEN_PAYLOAD_WARNING_ERROR_CODES)[number]
>;
const _everyPayloadSchemaErrorCodeClassified: UnclassifiedPayloadSchemaErrorCode extends never
  ? true
  : never = true;
void _everyPayloadSchemaErrorCodeClassified;

const BLOCKING_ERROR_CODE_SET: ReadonlySet<string> = new Set(LEADGEN_PAYLOAD_BLOCKING_ERROR_CODES);

export function isBlockingPayloadSchemaError(code: LeadgenPayloadSchemaErrorCode): boolean {
  return BLOCKING_ERROR_CODE_SET.has(code);
}

// The B7 split gate consumers use: SAVE rejects on `blocking.length > 0`
// (same 400 shape as before) and persists with `warnings` otherwise; the
// Test tool blocks on blocking only (05 §5.5 "warning-class errors don't
// block").
export function splitPayloadSchemaErrors(errors: readonly LeadgenPayloadSchemaError[]): {
  blocking: LeadgenPayloadSchemaError[];
  warnings: LeadgenPayloadSchemaError[];
} {
  const blocking: LeadgenPayloadSchemaError[] = [];
  const warnings: LeadgenPayloadSchemaError[] = [];
  for (const error of errors) {
    (isBlockingPayloadSchemaError(error.code) ? blocking : warnings).push(error);
  }
  return { blocking, warnings };
}

export interface LeadgenPayloadSchemaValidation {
  // B7 (05 §5.5): `ok` means "no BLOCKING-class error" — a schema whose only
  // findings are warning-class is VALID (saveable, testable, and — via
  // validation.ts dynamicAuctionEligibility, which keys on this flag —
  // auction-eligible). Warning-class findings still ride `errors[]`; split
  // them with splitPayloadSchemaErrors.
  ok: boolean;
  errors: LeadgenPayloadSchemaError[];
}

// Same dotted-path grammar the response macros use: 1+ [A-Za-z0-9_]+
// segments joined by single dots; numeric segments are array indices.
const PAYLOAD_PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

// Path segments that would let a stored schema walk into the prototype chain
// during setAtPath and pollute Object.prototype for the whole (shared) Worker
// isolate. The grammar above admits them (all [A-Za-z0-9_]), so they are
// rejected explicitly at validate AND guarded defensively in the writer.
const FORBIDDEN_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

const NODE_TYPE_SET: ReadonlySet<string> = new Set(LEADGEN_PAYLOAD_NODE_TYPES);
const SOURCE_SET: ReadonlySet<string> = new Set(LEADGEN_PAYLOAD_SOURCES);
const CONDITION_OPS: readonly LeadgenConditionOp[] = [
  "eq",
  "neq",
  "gt",
  "lt",
  "gte",
  "lte",
  "range",
  "in",
  "not_in",
] as const;
const CONDITION_OP_SET: ReadonlySet<string> = new Set(CONDITION_OPS);
const TRANSFORM_KINDS = [
  "mapBoolean",
  "mapEnum",
  "formatDate",
  "formatPhone",
  "toNumber",
  "toString",
  "trim",
] as const;
const TRANSFORM_KIND_SET: ReadonlySet<string> = new Set(TRANSFORM_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Enum membership uses SameValueZero (Array.prototype.includes) — the
// §11.1 valid_values domain is a list of JSON primitives.
function inValidValues(value: unknown, validValues: readonly unknown[]): boolean {
  return validValues.includes(value);
}

function validateTransformSteps(
  raw: unknown,
  path: string,
  errors: LeadgenPayloadSchemaError[],
): void {
  if (!Array.isArray(raw)) {
    errors.push({ code: "transform_invalid", path, message: "transform must be an array of steps" });
    return;
  }
  for (const step of raw) {
    if (!isRecord(step) || typeof step["kind"] !== "string" || !TRANSFORM_KIND_SET.has(step["kind"])) {
      errors.push({
        code: "transform_invalid",
        path,
        message: `unknown transform step (allowed: ${TRANSFORM_KINDS.join(", ")})`,
      });
      continue;
    }
    if (step["kind"] === "mapEnum" && !isRecord(step["map"])) {
      errors.push({ code: "transform_invalid", path, message: "mapEnum requires a map object" });
    }
    if (
      step["kind"] === "formatDate" &&
      (typeof step["format"] !== "string" || step["format"].trim() === "")
    ) {
      errors.push({ code: "transform_invalid", path, message: "formatDate requires a format string" });
    }
  }
}

// B9 (06 §6.4): typed choiceDisplay validation. Every finding is the
// warning-class `choice_display_invalid` (display-only metadata — see the
// classification table). The value domain mainValues must live inside is
// value_map internal keys ∪ valid_values (stringified — the render leg
// matches String(choice.value)); a node declaring NO domain cannot mark
// main values (the Section's choice list is the answer-map layer's concern,
// not the pure schema's).
const CHOICE_DISPLAY_KEYS = [
  "mainValues",
  "otherGroupEnabled",
  "otherGroupLabel",
  "searchableOther",
] as const;
const CHOICE_DISPLAY_KEY_SET: ReadonlySet<string> = new Set(CHOICE_DISPLAY_KEYS);

function validateChoiceDisplay(
  raw: unknown,
  node: Record<string, unknown>,
  nodeSource: LeadgenPayloadSource | null,
  path: string,
  errors: LeadgenPayloadSchemaError[],
): void {
  const push = (message: string): void => {
    errors.push({ code: "choice_display_invalid", path, message });
  };
  if (nodeSource !== "answer") {
    push("choiceDisplay is only valid on source 'answer' nodes");
    return;
  }
  if (!isRecord(raw)) {
    push("choiceDisplay must be an object");
    return;
  }
  for (const key of Object.keys(raw)) {
    if (!CHOICE_DISPLAY_KEY_SET.has(key)) {
      push(`unknown choiceDisplay key '${key}' (allowed: ${CHOICE_DISPLAY_KEYS.join(", ")})`);
    }
  }
  const mainValues = raw["mainValues"];
  if (mainValues !== undefined) {
    if (!Array.isArray(mainValues)) {
      push("choiceDisplay.mainValues must be an array of strings");
    } else {
      const nonStrings = mainValues.filter((v) => typeof v !== "string");
      if (nonStrings.length > 0) {
        push(
          `choiceDisplay.mainValues must be strings (offenders: ${nonStrings
            .map((v) => JSON.stringify(v))
            .join(", ")})`,
        );
      }
      // Allowed domain = value_map internal keys ∪ valid_values (§6.4).
      const domain = new Set<string>();
      const valueMap = node["value_map"];
      if (isRecord(valueMap)) for (const key of Object.keys(valueMap)) domain.add(key);
      const validValues = node["valid_values"];
      if (Array.isArray(validValues)) for (const v of validValues) domain.add(String(v));
      const offenders = mainValues.filter(
        (v): v is string => typeof v === "string" && !domain.has(v),
      );
      if (offenders.length > 0) {
        push(
          `choiceDisplay.mainValues outside the node's value domain (value_map keys ∪ valid_values): ${offenders.join(", ")}`,
        );
      }
    }
  }
  for (const key of ["otherGroupEnabled", "searchableOther"] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== "boolean") {
      push(`choiceDisplay.${key} must be a boolean`);
    }
  }
  if (raw["otherGroupLabel"] !== undefined && typeof raw["otherGroupLabel"] !== "string") {
    push("choiceDisplay.otherGroupLabel must be a string");
  }
}

// §6.5 (B12): free-text constraint validation. The three fields are valid
// ONLY on a free-text string answer node (source:"answer" + type:"string" +
// no value_map + no valid_values — exactly the mode the UI toggle
// expresses). Every defect is the BLOCKING `free_text_constraint_invalid`:
// a bad config must never reach the runtime enforcement leg.
const FREE_TEXT_PATTERN_SET: ReadonlySet<string> = new Set(LEADGEN_FREE_TEXT_PATTERNS);
export const FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH = 200;
// Runtime input ceiling. This bounds POLYNOMIAL cost only (a linear/quadratic
// regex over ≤4096 chars stays cheap). It does NOT and CANNOT bound EXPONENTIAL
// backtracking — that blows up at ~30 chars, far under any useful cap — so the
// exponential class is closed at SAVE time by isCatastrophicRegexShape below,
// not here. Applied unconditionally (even when free_text_max_length is unset)
// so a linear custom pattern can never `.test()` an unbounded visitor answer.
export const FREE_TEXT_RUNTIME_INPUT_HARD_CAP = 4096;

// Save-time catastrophic-backtracking screen. Exponential ReDoS comes from a
// quantifier governing a subexpression that itself can match ambiguously —
// classically a nested quantifier ("(a+)+", "((a)+)+", "(([a-z])+)+") or a
// quantified alternation ("(a|a)+", "(cat|dog)+"). A flat regex screen misses
// nesting (its char class can't cross parens — the c18bf8e evasion), so this
// walks the pattern paren-depth-aware: it rejects any unbounded quantifier
// (+ * {n,}) applied to a GROUP whose body — at ANY depth — contains another
// quantifier or a top-level-of-that-group alternation. SOUND (never admits an
// exponential shape); conservatively over-rejects some safe quantified
// alternations like "(cat|dog)+" (author those as valid_values or via the
// Advanced drawer) — a safe-side usability trade-off, DEV-38.
function isCatastrophicRegexShape(pattern: string): boolean {
  interface Frame { hasQuantifier: boolean; hasAlternation: boolean; }
  const stack: Frame[] = [{ hasQuantifier: false, hasAlternation: false }];
  let justClosed: Frame | null = null; // the group closed by the most recent ')'
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") { i++; justClosed = null; continue; } // skip escaped char
    if (ch === "[") { // skip a char class wholesale (its contents are literal)
      i++;
      while (i < pattern.length && pattern[i] !== "]") { if (pattern[i] === "\\") i++; i++; }
      justClosed = null;
      continue;
    }
    if (ch === "(") { stack.push({ hasQuantifier: false, hasAlternation: false }); justClosed = null; continue; }
    if (ch === "|") { stack[stack.length - 1]!.hasAlternation = true; justClosed = null; continue; }
    if (ch === ")") {
      justClosed = stack.length > 1 ? stack.pop()! : null;
      // Propagate the closed group's flags UP: its body's quantifier/alternation
      // is now "contained at some depth" by the parent — so a quantifier that
      // later governs the parent is caught (closes the "((a+))+" nested evasion).
      if (justClosed !== null) {
        const parent = stack[stack.length - 1]!;
        if (justClosed.hasQuantifier) parent.hasQuantifier = true;
        if (justClosed.hasAlternation) parent.hasAlternation = true;
      }
      continue;
    }
    if (ch === "+" || ch === "*" || (ch === "{" && isUnboundedBrace(pattern, i))) {
      if (justClosed !== null) {
        // this quantifier governs the just-closed group
        if (justClosed.hasQuantifier || justClosed.hasAlternation) return true; // exponential shape
        stack[stack.length - 1]!.hasQuantifier = true; // the group (now quantified) is a quantifier in its parent
      } else {
        stack[stack.length - 1]!.hasQuantifier = true; // quantifier on a bare atom
      }
      justClosed = null;
      continue;
    }
    justClosed = null;
  }
  return false;
}
// A "{...}" quantifier is unbounded-ish (exponential-capable) when it has no
// upper bound: {n,} . Bounded {n} / {n,m} can't drive exponential blowup.
function isUnboundedBrace(pattern: string, openIdx: number): boolean {
  const close = pattern.indexOf("}", openIdx);
  if (close === -1) return false; // a literal "{"
  const body = pattern.slice(openIdx + 1, close);
  return /^\d*,$/.test(body); // {n,} or {,}
}

const FREE_TEXT_CONSTRAINT_KEYS = [
  "free_text_max_length",
  "free_text_pattern",
  "free_text_pattern_custom",
] as const;

function validateFreeTextConstraints(
  node: Record<string, unknown>,
  nodeType: LeadgenPayloadNodeType | null,
  nodeSource: LeadgenPayloadSource | null,
  path: string,
  errors: LeadgenPayloadSchemaError[],
): void {
  const present = FREE_TEXT_CONSTRAINT_KEYS.filter((k) => node[k] !== undefined);
  if (present.length === 0) return;
  const push = (message: string): void => {
    errors.push({ code: "free_text_constraint_invalid", path, message });
  };
  const isFreeTextNode =
    nodeSource === "answer" &&
    nodeType === "string" &&
    node["value_map"] === undefined &&
    node["valid_values"] === undefined;
  if (!isFreeTextNode) {
    push(
      `${present.join(", ")} require a free-text string answer node (source 'answer', type 'string', no value_map / valid_values)`,
    );
    return;
  }
  const maxLength = node["free_text_max_length"];
  if (
    maxLength !== undefined &&
    (typeof maxLength !== "number" || !Number.isInteger(maxLength) || maxLength < 1)
  ) {
    push("free_text_max_length must be a positive integer");
  }
  const pattern = node["free_text_pattern"];
  if (pattern !== undefined && (typeof pattern !== "string" || !FREE_TEXT_PATTERN_SET.has(pattern))) {
    push(`free_text_pattern must be one of ${LEADGEN_FREE_TEXT_PATTERNS.join("|")}`);
  }
  const custom = node["free_text_pattern_custom"];
  if (pattern === "custom") {
    if (typeof custom !== "string" || custom.trim() === "") {
      push("free_text_pattern 'custom' requires free_text_pattern_custom");
    } else if (custom.length > FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH) {
      push(
        `free_text_pattern_custom must be at most ${FREE_TEXT_CUSTOM_PATTERN_MAX_LENGTH} characters`,
      );
    } else if (isCatastrophicRegexShape(custom)) {
      push("free_text_pattern_custom has a catastrophic-backtracking shape (quantified nested-quantifier or alternation group)");
    } else {
      try {
        // Compile check only — the runtime compiles its own instance.
        void new RegExp(custom);
      } catch {
        push("free_text_pattern_custom is not a valid regular expression");
      }
    }
  } else if (custom !== undefined) {
    push("free_text_pattern_custom is only valid with free_text_pattern 'custom'");
  }
}

function validateConditional(
  raw: unknown,
  path: string,
  errors: LeadgenPayloadSchemaError[],
): void {
  if (!isRecord(raw)) {
    errors.push({ code: "conditional_invalid", path, message: "conditional must be an object" });
    return;
  }
  if (typeof raw["when"] !== "string" || raw["when"].trim() === "") {
    errors.push({ code: "conditional_invalid", path, message: "conditional.when is required" });
  }
  const op = raw["op"];
  if (typeof op !== "string" || !CONDITION_OP_SET.has(op)) {
    errors.push({
      code: "conditional_invalid",
      path,
      message: `conditional.op must be one of ${CONDITION_OPS.join("|")}`,
    });
    return;
  }
  if (op === "range" && (typeof raw["from"] !== "number" || typeof raw["to"] !== "number")) {
    errors.push({ code: "conditional_invalid", path, message: "range conditional requires from + to numbers" });
  }
  if ((op === "in" || op === "not_in") && !Array.isArray(raw["values"])) {
    errors.push({ code: "conditional_invalid", path, message: `${op} conditional requires a values array` });
  }
}

// Validate a parsed schema_json value against the 04 §11.5 shape. Pure —
// referential checks (does internal_field exist on a mapped Section?) are
// the answer-map layer's concern, not the schema's.
export function validatePayloadSchema(raw: unknown): LeadgenPayloadSchemaValidation {
  const errors: LeadgenPayloadSchemaError[] = [];
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [{ code: "schema_not_object", message: "schema_json must be a JSON object" }],
    };
  }
  const version = raw["version"];
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    errors.push({ code: "version_invalid", message: "version must be a positive integer" });
  }
  const root = raw["root"];
  if (!isRecord(root) || root["type"] !== "object" || !Array.isArray(root["children"])) {
    errors.push({
      code: "root_invalid",
      message: 'root must be { type:"object", children:[...] }',
    });
    return { ok: false, errors };
  }

  const seenPaths = new Map<string, LeadgenPayloadNodeType>();
  let tokenNodes = 0;

  for (const node of root["children"]) {
    if (!isRecord(node)) {
      errors.push({ code: "node_not_object", message: "every child node must be an object" });
      continue;
    }
    const path = typeof node["path"] === "string" ? node["path"] : "";
    if (!PAYLOAD_PATH_RE.test(path)) {
      errors.push({
        code: "path_invalid",
        path: path === "" ? undefined : path,
        message: "path must be a dotted [A-Za-z0-9_] path",
      });
      continue;
    }
    if (path.split(".").some((seg) => FORBIDDEN_PATH_SEGMENTS.has(seg))) {
      errors.push({
        code: "path_invalid",
        path,
        message: "path may not contain __proto__, constructor, or prototype",
      });
      continue;
    }
    if (seenPaths.has(path)) {
      errors.push({ code: "path_duplicate", path, message: `duplicate path '${path}'` });
      continue;
    }

    const type = node["type"];
    const nodeType: LeadgenPayloadNodeType | null =
      typeof type === "string" && NODE_TYPE_SET.has(type) ? (type as LeadgenPayloadNodeType) : null;
    if (nodeType === null) {
      errors.push({
        code: "type_invalid",
        path,
        message: `type must be one of ${LEADGEN_PAYLOAD_NODE_TYPES.join("|")}`,
      });
    }
    seenPaths.set(path, nodeType ?? "string");

    // The JSON key must equal the last path segment (§11.5 example invariant:
    // path "data.home_own" ↔ name "home_own"); a mismatch means the builder
    // UI and the built payload would disagree about the field's identity.
    const name = node["name"];
    const lastSegment = path.split(".").pop() ?? "";
    if (typeof name !== "string" || name.trim() === "") {
      errors.push({ code: "name_invalid", path, message: "name is required" });
    } else if (name !== lastSegment) {
      errors.push({
        code: "name_path_mismatch",
        path,
        message: `name '${name}' must equal the last path segment '${lastSegment}'`,
      });
    }

    const source = node["source"];
    const nodeSource: LeadgenPayloadSource | null =
      typeof source === "string" && SOURCE_SET.has(source) ? (source as LeadgenPayloadSource) : null;
    if (nodeSource === null) {
      errors.push({
        code: "source_invalid",
        path,
        message: `source must be one of ${LEADGEN_PAYLOAD_SOURCES.join("|")}`,
      });
    }

    // Enum domain rules (§11.1 valid_values).
    const validValues = node["valid_values"];
    if (validValues !== undefined && !Array.isArray(validValues)) {
      errors.push({ code: "valid_values_invalid", path, message: "valid_values must be an array" });
    }
    if (nodeType === "enum") {
      if (!Array.isArray(validValues) || validValues.length === 0) {
        errors.push({
          code: "enum_valid_values_required",
          path,
          message: "type 'enum' requires a non-empty valid_values array",
        });
      } else {
        // default / fallback / static value must live inside the domain.
        // §6.9 computed references are SKIPPED — their runtime value is
        // dynamic and cannot be checked statically (the key itself is
        // validated below).
        for (const key of ["default", "fallback", "value"] as const) {
          const v = node[key];
          if (v === undefined) continue;
          if ((key === "default" || key === "fallback") && isComputedRefIntent(v)) continue;
          if (!inValidValues(v, validValues)) {
            errors.push({
              code: "enum_value_violation",
              path,
              message: `${key} is not one of valid_values`,
            });
          }
        }
      }
    }

    // Per-source integrity rules.
    if (nodeSource === "answer") {
      if (typeof node["internal_field"] !== "string" || node["internal_field"].trim() === "") {
        errors.push({
          code: "answer_missing_internal_field",
          path,
          message: "source 'answer' requires internal_field",
        });
      }
      if (node["value_map"] !== undefined && !isRecord(node["value_map"])) {
        errors.push({ code: "value_map_invalid", path, message: "value_map must be an object" });
      }
      if (node["transform"] !== undefined) {
        validateTransformSteps(node["transform"], path, errors);
      }
    }
    if (nodeSource === "static" && node["value"] === undefined) {
      errors.push({ code: "static_missing_value", path, message: "source 'static' requires value" });
    }
    if (nodeSource === "computed") {
      const computedKey = node["computed"];
      if (typeof computedKey !== "string" || computedKey.trim() === "") {
        errors.push({ code: "computed_missing_key", path, message: "source 'computed' requires computed key" });
      } else if (!isLeadgenComputedKey(computedKey)) {
        // The COMPUTED_REGISTRY is the ONLY source of computed keys
        // (fix-contract v2.4 04 §4.4) — free-text keys are rejected at save.
        errors.push({
          code: "computed_unknown_key",
          path,
          message: `'${computedKey}' is not a computed variable (valid keys: ${LEADGEN_COMPUTED_KEYS.join(", ")})`,
        });
      }
    }
    if (nodeSource === "macro") {
      const macro = node["macro"];
      if (typeof macro !== "string" || macro.trim() === "") {
        errors.push({ code: "macro_missing_name", path, message: "source 'macro' requires macro" });
      } else if (!isCanonicalMacro(macro)) {
        errors.push({
          code: "macro_unknown",
          path,
          message: `'${macro}' is not a canonical macro`,
        });
      }
    }
    if (nodeSource === "token") {
      // The token node is the §11.5 `auth.api_token` pattern: a string leaf
      // whose value is the server-resolved secret. It carries no mapping
      // machinery, and an Offer has exactly ONE token placement.
      tokenNodes += 1;
      if (tokenNodes > 1) {
        errors.push({ code: "token_node_duplicate", path, message: "at most one token node" });
      }
      if (nodeType !== "string") {
        errors.push({ code: "token_node_invalid", path, message: "token node must be type 'string'" });
      }
      for (const key of ["internal_field", "value_map", "transform", "value"] as const) {
        if (node[key] !== undefined) {
          errors.push({
            code: "token_node_invalid",
            path,
            message: `token node must not carry ${key}`,
          });
        }
      }
    }

    // §6.9: default/fallback may be the typed computed reference
    // {source:"computed", key} — the key must exist in COMPUTED_REGISTRY.
    // Errors reuse the existing computed_* codes, path-scoped to the node
    // with the offending SLOT named in the message.
    for (const slot of ["default", "fallback"] as const) {
      const slotValue = node[slot];
      if (!isComputedRefIntent(slotValue)) continue;
      const key = (slotValue as Record<string, unknown>)["key"];
      if (typeof key !== "string" || key.trim() === "") {
        errors.push({
          code: "computed_missing_key",
          path,
          message: `${slot}: a computed value reference requires a key`,
        });
      } else if (!isLeadgenComputedKey(key)) {
        errors.push({
          code: "computed_unknown_key",
          path,
          message: `${slot}: '${key}' is not a computed variable (valid keys: ${LEADGEN_COMPUTED_KEYS.join(", ")})`,
        });
      }
    }

    if (node["conditional"] !== undefined) {
      validateConditional(node["conditional"], path, errors);
    }

    // B9 (06 §6.4): optional Other-group display metadata, answer nodes only.
    if (node["choiceDisplay"] !== undefined) {
      validateChoiceDisplay(node["choiceDisplay"], node, nodeSource, path, errors);
    }

    // §6.5 (B12): optional free-text constraints, free-text string answer
    // nodes only.
    validateFreeTextConstraints(node, nodeType, nodeSource, path, errors);
  }

  // Placement conflicts: a SCALAR node's path may not be the prefix of
  // another node's path (writing `data` as a string forbids `data.x`).
  // Container-typed nodes (object/array) MAY be prefixes — they declare the
  // container an admin can attach children to.
  for (const [path, type] of seenPaths) {
    if (type === "object" || type === "array") continue;
    for (const other of seenPaths.keys()) {
      if (other !== path && other.startsWith(`${path}.`)) {
        errors.push({
          code: "path_prefix_conflict",
          path,
          message: `scalar path '${path}' conflicts with nested path '${other}'`,
        });
        break;
      }
    }
  }

  // B7 (05 §5.5): `ok` = no BLOCKING-class error. Warning-class findings
  // (see the classification table) ride errors[] without failing the schema.
  return { ok: errors.every((e) => !isBlockingPayloadSchemaError(e.code)), errors };
}

// ---------------------------------------------------------------------------
// cleanObject — the "no fabrication" rule (04 §11.5)
// ---------------------------------------------------------------------------

// Recursively drop undefined, null, empty-string, empty-object and
// empty-array values. Scalars 0 and false are VALID payload values and are
// KEPT (01 §3 anti-pattern list: never treat 0 as absent). Returns
// undefined when the value cleans away entirely.
export function cleanObject(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (Array.isArray(value)) {
    const cleaned: unknown[] = [];
    for (const item of value) {
      const c = cleanObject(item);
      if (c !== undefined) cleaned.push(c);
    }
    return cleaned.length === 0 ? undefined : cleaned;
  }
  if (isRecord(value)) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const c = cleanObject(item);
      if (c !== undefined) cleaned[key] = c;
    }
    return Object.keys(cleaned).length === 0 ? undefined : cleaned;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Transforms (05 §12 normative pipeline set)
// ---------------------------------------------------------------------------

const TRUE_WORDS: ReadonlySet<string> = new Set(["true", "yes", "y", "1"]);
const FALSE_WORDS: ReadonlySet<string> = new Set(["false", "no", "n", "0"]);

// mapBoolean — the reference-proven boolean mapper: common yes/no answer
// spellings + 1/0 + real booleans. Anything else is INVALID (undefined).
function transformMapBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const word = value.trim().toLowerCase();
    if (TRUE_WORDS.has(word)) return true;
    if (FALSE_WORDS.has(word)) return false;
  }
  return undefined;
}

// formatDate(fmt) — deterministic UTC formatting of an ISO string / epoch-ms
// number through YYYY/MM/DD/HH/mm/ss tokens. Invalid dates are INVALID.
function transformFormatDate(value: unknown, format: string): unknown {
  let date: Date | null = null;
  if (typeof value === "number" && Number.isFinite(value)) date = new Date(value);
  else if (typeof value === "string" && value.trim() !== "") date = new Date(value);
  if (date === null || Number.isNaN(date.getTime())) return undefined;
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  return format
    .replace(/YYYY/g, pad(date.getUTCFullYear(), 4))
    .replace(/MM/g, pad(date.getUTCMonth() + 1, 2))
    .replace(/DD/g, pad(date.getUTCDate(), 2))
    .replace(/HH/g, pad(date.getUTCHours(), 2))
    .replace(/mm/g, pad(date.getUTCMinutes(), 2))
    .replace(/ss/g, pad(date.getUTCSeconds(), 2));
}

// formatPhone — normalize a US phone to its 10 digits (strip punctuation,
// drop a leading `1` country code from 11-digit numbers). Anything that
// does not normalize to exactly 10 digits is INVALID.
function transformFormatPhone(value: unknown): unknown {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  let digits = String(value).replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length === 10 ? digits : undefined;
}

function applyTransformStep(value: unknown, step: LeadgenTransformStep): unknown {
  switch (step.kind) {
    case "mapBoolean":
      return transformMapBoolean(value);
    case "mapEnum": {
      // Lookup by the stringified input (value_map keys are JSON object
      // keys, i.e. strings — the §11.5 example maps "true"/"false").
      const mapped = step.map[String(value)];
      return mapped === undefined ? undefined : mapped;
    }
    case "formatDate":
      return transformFormatDate(value, step.format);
    case "formatPhone":
      return transformFormatPhone(value);
    case "toNumber": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    case "toString": {
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return undefined;
    }
    case "trim":
      // trim is a string transform; non-strings pass through unchanged.
      return typeof value === "string" ? value.trim() : value;
  }
}

// Run a transform pipeline left-to-right. Any step yielding undefined marks
// the value INVALID (the node then takes its fallback).
export function applyTransformPipeline(
  value: unknown,
  steps: readonly LeadgenTransformStep[],
): unknown {
  let current: unknown = value;
  for (const step of steps) {
    if (current === undefined) return undefined;
    current = applyTransformStep(current, step);
  }
  return current;
}

// ---------------------------------------------------------------------------
// Runtime build (04 §11.5)
// ---------------------------------------------------------------------------

export interface LeadgenPayloadTokenContext {
  // The server-resolved secret value (readEnvSecret). Absent secret ⇒ the
  // token leg no-ops (09 §30.2) — the node cleans away.
  value?: string;
  api_token_placement: LeadgenApiTokenPlacement | null;
  request_execution_mode: LeadgenRequestExecutionMode;
}

export interface LeadgenPayloadBuildContext {
  // Internal normalized answers (05 §12.7 pivot): internal_field → value.
  answers: Readonly<Record<string, unknown>>;
  // Canonical macro runtime values (macros.ts registry names).
  macros?: Readonly<Record<string, string>>;
  // Server-derived computed values, keyed by the node's `computed` key.
  computed?: Readonly<Record<string, unknown>>;
  // The Offer in scope (fix-contract v2.4 04 §4.5) — source:"placement"
  // resolves from offer.placement_id. Bridged from the canonical
  // LeadGenRuntimeContext.offer slice (runtime-context.ts).
  offer?: Readonly<{ offer_id?: string; offer_name?: string; placement_id?: string }>;
  token?: LeadgenPayloadTokenContext;
}

// CONDUCTOR FIX (register PC-12, 2026-07-17) — boolean/string equality-shape
// equivalence, mirrored byte-for-byte from the client evaluator
// (public/leadgen/runtime/dependencies.ts conditionMet's own normalizeBoolShape):
// a LIVE TwoButtonYesNo click records the raw string "true"/"false" (no
// `choices` array to type-resolve against — engine.ts handleChoiceActivation),
// while the studio's typed pickers (buildConditional/typedScalar) AND a
// defaulted answer's props.defaultValue author/apply a REAL boolean for a
// boolean-typed `when` field — so both shapes coexist in live answers. This
// function is the SINGLE evaluator payload-build (node-drop, below),
// dependencies.ts (show/hide/require — the public funnel's client evaluator
// mirrors it), and auction-rules.ts conditionsMatch (offer/carrier
// eligibility) all share — leaving it strict here while the client
// normalized would have created a NEW divergence class: a component
// correctly SHOWN client-side silently DROPPED from the auction payload
// (show-but-don't-submit, a money-path bug), and an auction/carrier rule
// authored against a boolean field that could never match a live answer.
// Scoped to EXACTLY eq/neq/in/not_in (equality family); gt/lt/gte/lte/range
// are UNCHANGED — they already coerce via Number(), where Number(true)===1
// must stay exact.
function normalizeBoolShape(value: unknown): unknown {
  if (value === true) return "true";
  if (value === false) return "false";
  return value;
}

// A composed group is detected structurally by an array `conditions` (a bare
// conditional never carries one) — the client twin uses the identical guard.
export function isPayloadConditionGroup(v: unknown): v is LeadgenPayloadConditionGroup {
  return (
    v !== null &&
    typeof v === "object" &&
    Array.isArray((v as { conditions?: unknown }).conditions)
  );
}

// 07 §21.4 semantics scoped to one field: OR within `values`, numeric
// comparisons only over finite numbers. An ABSENT answer never satisfies a
// conditional (deterministic: unmet ⇒ node dropped). Exported as the single
// source of condition-op truth: the §12.3 dependency engine (dependencies.ts)
// reuses THIS evaluator so payload-build and show/hide/require never diverge.
// A-4: also accepts the composed {match,conditions} group — match:"any" = OR
// (some), anything else (incl. "all"/absent) = AND (every); empty conditions
// follows every/some (all ⇒ true, any ⇒ false). This mirrors the client
// conditionMet leg-for-leg so a composed rule evaluates identically on both
// sides (the parity table covers every op × shape × match).
export function conditionalMet(
  conditional: LeadgenPayloadConditional | LeadgenPayloadConditionGroup,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if (isPayloadConditionGroup(conditional)) {
    return conditional.match === "any"
      ? conditional.conditions.some((c) => conditionalMet(c, answers))
      : conditional.conditions.every((c) => conditionalMet(c, answers));
  }
  const actual = answers[conditional.when];
  if (actual === undefined) return false;
  switch (conditional.op) {
    case "eq":
      return normalizeBoolShape(actual) === normalizeBoolShape(conditional.value);
    case "neq":
      return normalizeBoolShape(actual) !== normalizeBoolShape(conditional.value);
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const n = typeof actual === "number" ? actual : Number(actual);
      const bound = typeof conditional.value === "number" ? conditional.value : Number.NaN;
      if (!Number.isFinite(n) || !Number.isFinite(bound)) return false;
      if (conditional.op === "gt") return n > bound;
      if (conditional.op === "lt") return n < bound;
      if (conditional.op === "gte") return n >= bound;
      return n <= bound;
    }
    case "range": {
      const n = typeof actual === "number" ? actual : Number(actual);
      if (!Number.isFinite(n)) return false;
      const from = conditional.from;
      const to = conditional.to;
      if (typeof from !== "number" || typeof to !== "number") return false;
      // Inclusive bounds — "age 25–64" reads as [25, 64].
      return n >= from && n <= to;
    }
    case "in": {
      // Array.includes (SameValueZero, e.g. NaN-membership) over the
      // bool-normalized values — matches the pre-fix behavior for every
      // non-boolean-shaped element, plus the new true/"true" equivalence.
      const actualNorm = normalizeBoolShape(actual);
      return Array.isArray(conditional.values) && conditional.values.map(normalizeBoolShape).includes(actualNorm);
    }
    case "not_in": {
      const actualNorm = normalizeBoolShape(actual);
      return Array.isArray(conditional.values) && !conditional.values.map(normalizeBoolShape).includes(actualNorm);
    }
  }
}

// provider_expected_type coercion (05 §12.7 pipeline step). Returns
// undefined when the value cannot represent the declared type — the node
// then takes its fallback. Deliberately strict: implicit conversions are
// the transforms' job (toNumber/toString/mapBoolean), not the coercer's.
function coerceToType(value: unknown, type: LeadgenPayloadNodeType): unknown {
  switch (type) {
    case "string":
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      return undefined;
    case "number": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
      }
      return undefined;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === 1) return true;
      if (value === "false" || value === 0) return false;
      return undefined;
    case "enum":
      // Membership is checked by the caller against valid_values; the
      // coercer only refuses non-primitive enum values.
      return typeof value === "object" ? undefined : value;
    case "object":
      return isRecord(value) ? value : undefined;
    case "array":
      return Array.isArray(value) ? value : undefined;
  }
}

// ---------------------------------------------------------------------------
// §6.5 free-text sanitize + constraint enforcement (B12)
// ---------------------------------------------------------------------------

// C0 control characters + DEL — the §6.5 "strip control chars" set. (The
// Section-level trim landed in answers.ts normalizeAnswerValue; THIS is the
// payload-resolution choke point both the runtime funnel and the Test tool
// share, so constraint enforcement lives here.)
const FREE_TEXT_CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

// §6.5 sanitize: strip control characters, then trim. Exported so previews
// and tests can mirror the runtime byte-for-byte.
export function sanitizeFreeText(value: string): string {
  return value.replace(FREE_TEXT_CONTROL_CHARS_RE, "").trim();
}

// Preset pattern semantics (anchored full-match): letters = A–Z/a–z plus
// plain spaces (post-sanitize the only whitespace left IS the space);
// digits = 0–9 only. "custom" tests the operator RegExp as authored — the
// operator anchors it when a full match is wanted. "none" = sanitize only.
const FREE_TEXT_PRESET_RES: Readonly<Record<string, RegExp>> = {
  letters: /^[A-Za-z ]+$/,
  digits: /^[0-9]+$/,
};

function nodeHasFreeTextConstraints(node: LeadgenPayloadNode): boolean {
  return (
    node.free_text_max_length !== undefined ||
    node.free_text_pattern !== undefined ||
    node.free_text_pattern_custom !== undefined
  );
}

// Sanitize + enforce the §6.5 constraints on one resolved free-text value.
// Returns the SANITIZED string, or undefined = INVALID → the caller's
// standard fallback machinery (never a throw, never silent acceptance): a
// non-string-coercible value, an over-long value, a pattern mismatch and a
// non-compiling custom pattern (save-blocked, but defended here) are all
// plain `undefined` invalids.
function applyFreeTextConstraints(value: unknown, node: LeadgenPayloadNode): unknown {
  const str = coerceToType(value, "string");
  if (typeof str !== "string") return undefined;
  const sanitized = sanitizeFreeText(str);
  // ReDoS defense, money path (answers are unbounded visitor input, NOT in the
  // signed tuple). TWO layers: (1) this input bound caps POLYNOMIAL cost — a
  // linear/quadratic pattern over ≤ceiling chars is cheap; it fires even when
  // free_text_max_length is unset. (2) EXPONENTIAL patterns are refused at SAVE
  // (isCatastrophicRegexShape) because no input cap bounds exponential blowup.
  // Over-ceiling → invalid → the caller's fallback (regex never runs, never throws).
  const effectiveMax = node.free_text_max_length ?? FREE_TEXT_RUNTIME_INPUT_HARD_CAP;
  if (sanitized.length > effectiveMax) {
    return undefined; // too long → invalid (regex never runs)
  }
  const pattern = node.free_text_pattern;
  if (pattern === "letters" || pattern === "digits") {
    const preset = FREE_TEXT_PRESET_RES[pattern];
    if (preset !== undefined && !preset.test(sanitized)) return undefined;
  } else if (pattern === "custom") {
    if (typeof node.free_text_pattern_custom !== "string") return undefined;
    // Belt-and-suspenders: refuse a catastrophic pattern AT RUNTIME too, not
    // only at save — a bomb could reach here via legacy/pre-fix stored data or
    // a direct DB edit that never passed validatePayloadSchema. Cheap (pattern
    // ≤200 chars) and makes the money path self-defending. Invalid → fallback.
    if (isCatastrophicRegexShape(node.free_text_pattern_custom)) return undefined;
    try {
      if (!new RegExp(node.free_text_pattern_custom).test(sanitized)) return undefined;
    } catch {
      return undefined;
    }
  }
  return sanitized;
}

// Write `value` at a dotted path. Numeric segments create/index arrays
// (`drivers.0.age` ⇒ { drivers: [ { age } ] }).
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  // Defense in depth: validatePayloadSchema already rejects these, but the
  // writer must never walk the prototype chain even if fed an unvalidated
  // schema (e.g. a future caller that skips validation).
  if (segments.some((seg) => FORBIDDEN_PATH_SEGMENTS.has(seg))) return;
  let cursor: Record<string, unknown> | unknown[] = target;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] ?? "";
    const isLast = i === segments.length - 1;
    const nextIsIndex = !isLast && /^\d+$/.test(segments[i + 1] ?? "");
    if (Array.isArray(cursor)) {
      const index = Number(segment);
      if (isLast) {
        cursor[index] = value;
      } else {
        const existing = cursor[index];
        if (existing === undefined || existing === null || typeof existing !== "object") {
          cursor[index] = nextIsIndex ? [] : {};
        }
        cursor = cursor[index] as Record<string, unknown> | unknown[];
      }
    } else {
      if (isLast) {
        cursor[segment] = value;
      } else {
        const existing = cursor[segment];
        if (existing === undefined || existing === null || typeof existing !== "object") {
          cursor[segment] = nextIsIndex ? [] : {};
        }
        cursor = cursor[segment] as Record<string, unknown> | unknown[];
      }
    }
  }
}

// Resolve one node to its FINAL output value (undefined = omitted). Order
// per 05 §12.7: source raw → value_map → transform pipeline → type coercion
// → enum domain check → default (absent) / fallback (invalid).
function resolveNode(node: LeadgenPayloadNode, ctx: LeadgenPayloadBuildContext): unknown {
  // Token nodes bypass the answer pipeline entirely: injected ONLY when the
  // Offer places its token in the payload AND the request executes server
  // side (04 §11.5 + §10.3 — client mode never sees a secret).
  if (node.source === "token") {
    const token = ctx.token;
    if (
      token === undefined ||
      token.api_token_placement !== "payload" ||
      token.request_execution_mode !== "server" ||
      typeof token.value !== "string" ||
      token.value === ""
    ) {
      return undefined;
    }
    return token.value;
  }

  let raw: unknown;
  switch (node.source) {
    case "answer":
      raw = node.internal_field === undefined ? undefined : ctx.answers[node.internal_field];
      break;
    case "static":
      raw = node.value;
      break;
    case "computed":
      raw = node.computed === undefined ? undefined : ctx.computed?.[node.computed];
      break;
    case "macro":
      raw = node.macro === undefined ? undefined : ctx.macros?.[node.macro];
      break;
    case "placement": {
      // §4.5 Offer/Auction placement id. A missing OR empty id routes
      // through the absent→default machinery below (an empty string is "no
      // placement in scope", never a real id) — never a crash.
      const placementId = ctx.offer?.placement_id;
      raw = typeof placementId === "string" && placementId !== "" ? placementId : undefined;
      break;
    }
  }

  // ABSENT source value → default (a FINAL value, not re-piped). §6.9: a
  // typed computed reference resolves via ctx.computed[key] here.
  if (raw === undefined || raw === null) return resolveDefaultOrFallback(node.default, ctx);

  let value: unknown = raw;
  if (node.source === "answer") {
    if (node.value_map !== undefined) {
      // value_map keys are strings (§11.5 example {"true":true,...}); a map
      // MISS marks the value invalid rather than passing it through — the
      // admin declared the full input domain by writing a map.
      value = node.value_map[String(value)];
    }
    if (value !== undefined && node.transform !== undefined) {
      value = applyTransformPipeline(value, node.transform);
    }
    // §6.5 free-text constraints (B12): ONLY nodes carrying the additive
    // free_text_* fields take this leg — sanitize (strip control chars +
    // trim) then enforce max length / pattern; a violation is INVALID →
    // the standard fallback below. Plain nodes without the fields skip it
    // entirely (§1.4 byte-compatibility).
    if (value !== undefined && nodeHasFreeTextConstraints(node)) {
      value = applyFreeTextConstraints(value, node);
    }
  }
  if (value !== undefined) {
    value = coerceToType(value, node.type);
  }
  if (
    value !== undefined &&
    node.type === "enum" &&
    Array.isArray(node.valid_values) &&
    !inValidValues(value, node.valid_values)
  ) {
    value = undefined;
  }

  // INVALID (map miss / transform reject / free-text violation / coercion
  // failure / enum violation) → fallback (a FINAL value). §6.9: a typed
  // computed reference resolves via ctx.computed[key] here.
  return value === undefined ? resolveDefaultOrFallback(node.fallback, ctx) : value;
}

// §6.9: a default/fallback slot value is either a LITERAL (returned
// verbatim — byte-identical to the pre-§6.9 behavior, legacy looseJson
// strings included) or the typed computed reference {source:"computed",
// key}, resolved from ctx.computed. A computed value that is ABSENT or
// undefined (key not populated in this build's context — e.g. a caller
// passing no ctx.computed) is treated as NO default/fallback: the node
// takes the existing absent path and cleans away. Malformed refs
// (save-blocked) defend the same way — never a throw.
function resolveDefaultOrFallback(slotValue: unknown, ctx: LeadgenPayloadBuildContext): unknown {
  if (!isComputedRefIntent(slotValue)) return slotValue;
  const key = (slotValue as Record<string, unknown>)["key"];
  if (typeof key !== "string") return undefined;
  return ctx.computed?.[key];
}

// Build the provider payload for one Offer (04 §11.5 runtime build). Pure
// and synchronous — secrets/macros/answers arrive pre-resolved in ctx.
export function buildPayload(
  schema: LeadgenPayloadSchema,
  ctx: LeadgenPayloadBuildContext,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const node of schema.root.children) {
    if (node.conditional !== undefined && !conditionalMet(node.conditional, ctx.answers)) {
      continue; // unmet conditional ⇒ node dropped (§11.5)
    }
    const value = resolveNode(node, ctx);
    if (value !== undefined) {
      setAtPath(out, node.path, value);
    }
  }
  const cleaned = cleanObject(out);
  return isRecord(cleaned) ? cleaned : {};
}

// ---------------------------------------------------------------------------
// Automatic generation — infer from example (04 §11.2)
// ---------------------------------------------------------------------------

// Infer an EDITABLE schema from a pasted example provider payload: walk the
// example, emit one flat leaf node per scalar (dotted path per the §11.5
// normative shape; numeric segments for array elements), and declare empty
// objects/arrays as container-typed nodes so their paths survive. Inferred
// nodes default to source:"static" carrying the example value — that keeps
// the inferred schema VALID as-is (validatePayloadSchema passes) while the
// admin re-sources fields to answers/macros/token and marks enum/required
// (§11.2: "editable schema ... never locks").
export function inferSchemaFromExample(example: unknown): LeadgenPayloadSchema {
  const children: LeadgenPayloadNode[] = [];

  const leafType = (value: unknown): LeadgenPayloadNodeType => {
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    // null infers as an (optional) string — the least-committal editable type.
    return "string";
  };

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      if (path !== "" && value.length === 0) {
        children.push(containerNode(path, "array"));
        return;
      }
      value.forEach((item, index) => walk(item, path === "" ? String(index) : `${path}.${index}`));
      return;
    }
    if (isRecord(value)) {
      const entries = Object.entries(value);
      if (path !== "" && entries.length === 0) {
        children.push(containerNode(path, "object"));
        return;
      }
      for (const [key, item] of entries) {
        // Keys outside the dotted-path grammar cannot be addressed by a
        // flat node list; they are skipped (the admin adds them manually).
        // Prototype-chain keys are likewise skipped so the inferred schema is
        // valid (validatePayloadSchema rejects them).
        if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
        if (FORBIDDEN_PATH_SEGMENTS.has(key)) continue;
        walk(item, path === "" ? key : `${path}.${key}`);
      }
      return;
    }
    if (path === "") return; // a bare primitive example carries no paths
    children.push({
      path,
      name: path.split(".").pop() ?? path,
      type: leafType(value),
      required: false,
      source: "static",
      value: value === null ? "" : value,
    });
  };

  const containerNode = (path: string, type: "object" | "array"): LeadgenPayloadNode => ({
    path,
    name: path.split(".").pop() ?? path,
    type,
    required: false,
    source: "static",
    value: type === "object" ? {} : [],
  });

  walk(example, "");
  return { version: 1, root: { type: "object", children } };
}
