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
// value_map + transform pipeline; static; computed; macro; token), coerce to
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

export const LEADGEN_PAYLOAD_SOURCES = [
  "answer",
  "static",
  "computed",
  "macro",
  "token",
] as const;
export type LeadgenPayloadSource = (typeof LEADGEN_PAYLOAD_SOURCES)[number];

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
  // source:"static" — the authored literal value.
  value?: unknown;
  // source:"computed" — key into ctx.computed (server-derived values).
  computed?: string;
  // source:"macro" — one of the 32 canonical macro names (macros.ts).
  macro?: string;
  conditional?: LeadgenPayloadConditional;
}

export interface LeadgenPayloadSchema {
  version: number;
  root: { type: "object"; children: LeadgenPayloadNode[] };
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
  | "macro_missing_name"
  | "macro_unknown"
  | "token_node_invalid"
  | "token_node_duplicate"
  | "conditional_invalid";

export interface LeadgenPayloadSchemaError {
  code: LeadgenPayloadSchemaErrorCode;
  // Offending node path where one exists (schema-level errors omit it).
  path?: string;
  message: string;
}

export interface LeadgenPayloadSchemaValidation {
  ok: boolean;
  errors: LeadgenPayloadSchemaError[];
}

// Same dotted-path grammar the response macros use: 1+ [A-Za-z0-9_]+
// segments joined by single dots; numeric segments are array indices.
const PAYLOAD_PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;

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
        for (const key of ["default", "fallback", "value"] as const) {
          const v = node[key];
          if (v !== undefined && !inValidValues(v, validValues)) {
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
    if (nodeSource === "computed" && (typeof node["computed"] !== "string" || node["computed"].trim() === "")) {
      errors.push({ code: "computed_missing_key", path, message: "source 'computed' requires computed key" });
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

    if (node["conditional"] !== undefined) {
      validateConditional(node["conditional"], path, errors);
    }
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

  return { ok: errors.length === 0, errors };
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
  token?: LeadgenPayloadTokenContext;
}

// 07 §21.4 semantics scoped to one field: OR within `values`, numeric
// comparisons only over finite numbers. An ABSENT answer never satisfies a
// conditional (deterministic: unmet ⇒ node dropped).
function conditionalMet(
  conditional: LeadgenPayloadConditional,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  const actual = answers[conditional.when];
  if (actual === undefined) return false;
  switch (conditional.op) {
    case "eq":
      return actual === conditional.value;
    case "neq":
      return actual !== conditional.value;
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
    case "in":
      return Array.isArray(conditional.values) && conditional.values.includes(actual);
    case "not_in":
      return Array.isArray(conditional.values) && !conditional.values.includes(actual);
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

// Write `value` at a dotted path. Numeric segments create/index arrays
// (`drivers.0.age` ⇒ { drivers: [ { age } ] }).
function setAtPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
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
  }

  // ABSENT source value → default (a FINAL value, not re-piped).
  if (raw === undefined || raw === null) return node.default;

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

  // INVALID (map miss / transform reject / coercion failure / enum
  // violation) → fallback (a FINAL value).
  return value === undefined ? node.fallback : value;
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
        if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
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
