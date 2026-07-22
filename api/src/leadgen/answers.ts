// LeadGen answer normalization pipeline (contract 05 §12.6/§12.7/§12.11 + the
// §16 worked example). PURE + deterministic — no I/O, no DB. Two legs:
//
//   1. Section-level normalization (§12.7 pivot): raw UI answers → the
//      internal normalized answer space (`internal_field` → `internal_value`)
//      keyed by each question's `internal_field` (plus the multi-field
//      name/address sub-fields). Every value is coerced to the component's
//      `answer_type` through the SAME primitives payload.ts uses (mapBoolean /
//      toNumber / trim), so the two layers can never drift.
//
//   2. Per-Offer leg (§12.11 order): the normalized answers feed payload.ts.
//      Each `leadgen_section_answer_maps` edge becomes a payload node
//      (path=offer_payload_field_path, type=provider_expected_type,
//      source="answer", internal_field, value_map=output_value_map,
//      transform=value_transform, default/fallback), and `buildPayload` runs
//      the normative pipeline: value_map → value_transform →
//      provider_expected_type coercion → default (absent) / fallback (invalid)
//      → cleanObject. The §16 example holds: UI `Yes` → `true` / `"Y"` /
//      `"yes"` / `1` across four Offers whose only difference is their map.
//
// `answer_source` (§12.6) is tracked per internal field: `default_applied`
// (untouched pre-set), `user_selected`, `user_confirmed_default` (touched, but
// equal to the default). These are the leadgen_analytics_answer_distribution
// canonical values (db-types LeadgenAnswerSource).

import {
  applyTransformPipeline,
  buildPayload,
  LEADGEN_PAYLOAD_NODE_TYPES,
  type LeadgenPayloadNode,
  type LeadgenPayloadNodeType,
  type LeadgenPayloadSchema,
  type LeadgenTransformStep,
} from "./payload";
import { COMPONENT_CATALOG } from "../public/leadgen/components/registry";
import { flattenComponents, readMultiQuestionRows } from "../public/leadgen/components/content-schema";
import type {
  LeadgenAnswerType,
  LeadgenComponentNode,
  LeadgenSectionContent,
} from "../public/leadgen/components/content-schema";
import type { LeadgenAnswerSource } from "../admin/leadgen/db-types";
// v3.1 §9 (S3-6) auction location facet seam. mapsJobsFor is the ONE §9.3
// per-field precedence reader (presets.ts — no import cycle: presets never
// imports this module); deriveLocationFacet is the pure facet primitive (maps.ts).
import { mapsJobsFor } from "../public/leadgen/components/presets";
import { deriveLocationFacet, type LeadgenLocationFacet } from "./maps";

// ---------------------------------------------------------------------------
// small local helpers (the validation.ts private idiom)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NODE_TYPE_SET: ReadonlySet<string> = new Set(LEADGEN_PAYLOAD_NODE_TYPES);

// ---------------------------------------------------------------------------
// Raw UI answer input
// ---------------------------------------------------------------------------

// A raw UI answer may arrive as a bare value or a `{ value, touched }` wrapper.
// `touched` is what distinguishes an UNTOUCHED default (default_applied) from a
// user-CONFIRMED default (user_confirmed_default, §12.6). A bare value is
// treated as user-provided (touched).
export interface LeadgenRawAnswer {
  value: unknown;
  touched?: boolean;
}

export type LeadgenRawAnswers = Readonly<Record<string, unknown>>;

interface ReadRaw {
  value: unknown;
  touched: boolean;
  present: boolean;
}

function readRaw(entry: unknown): ReadRaw {
  if (entry === undefined) return { value: undefined, touched: false, present: false };
  // A `{ value, touched? }` wrapper carries explicit provenance.
  if (isRecord(entry) && Object.prototype.hasOwnProperty.call(entry, "value")) {
    return { value: entry["value"], touched: entry["touched"] === true, present: true };
  }
  // A bare value is a user-provided answer.
  return { value: entry, touched: true, present: true };
}

// ---------------------------------------------------------------------------
// Section-level normalization (§12.7): raw UI → internal_value by answer_type
// ---------------------------------------------------------------------------

// The one place Section-level value coercion lives. Reuses payload.ts's
// transform primitives (mapBoolean / trim) so the runtime + the payload build
// share the exact same boolean/whitespace semantics; currency/number strip
// display formatting the transforms don't (the range display carries "$" and
// thousands separators, §14.5).
export function normalizeAnswerValue(raw: unknown, answerType: LeadgenAnswerType): unknown {
  switch (answerType) {
    case "boolean":
      // yes/y/true/1 → true; no/n/false/0 → false; anything else → invalid.
      return applyTransformPipeline(raw, [{ kind: "mapBoolean" }]);
    case "number":
      return toNumberLoose(raw);
    case "currency":
      return toCurrencyNumber(raw);
    case "enum":
      // Enum choice values are string|number|boolean primitives; strings trim,
      // other primitives pass through, non-primitives are invalid.
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        return trimmed === "" ? undefined : trimmed;
      }
      return typeof raw === "number" || typeof raw === "boolean" ? raw : undefined;
    case "array":
      return Array.isArray(raw) ? raw : undefined;
    case "object":
      return isRecord(raw) ? raw : undefined;
    case "string":
      if (typeof raw === "string") {
        const trimmed = raw.trim();
        return trimmed === "" ? undefined : trimmed;
      }
      // A number/boolean answer bound to a string field stringifies.
      return typeof raw === "number" || typeof raw === "boolean" ? String(raw) : undefined;
  }
}

function toNumberLoose(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toCurrencyNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    // Strip currency symbol + thousands separators ("$330,000" → "330000").
    const stripped = raw.replace(/[^0-9.\-]/g, "");
    if (stripped === "") return undefined;
    const n = Number(stripped);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// internal-field enumeration per component
// ---------------------------------------------------------------------------

interface FieldSpec {
  field: string;
  answerType: LeadgenAnswerType;
  hasDefault: boolean;
  defaultValue: unknown;
  // §12.7 array-answer SELECTION-COUNT bounds (MultiChoiceCardGroup
  // props.min/max — registry.ts "min<=count<=max"). Read here (the only place
  // with node access); enforced in normalizeAnswers against the already-
  // array-typed normalized value, so a non-array answerType never triggers a
  // spurious count check even though every node's min/max is read uniformly.
  minCount?: number;
  maxCount?: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown, fallback: readonly string[]): string[] {
  if (Array.isArray(value)) {
    const out = value.filter((v): v is string => isNonEmptyString(v));
    if (out.length > 0) return out;
  }
  return [...fallback];
}

// The internal fields a component contributes to the answer space. A scalar
// question uses its `internal_field`; NameFieldsGroup + AddressAutocomplete
// expand to their sub-fields (§12.8 "distinct internal fields street/city/
// state/zip"). Chrome/controls/affordances contribute none.
function fieldsOf(node: LeadgenComponentNode): FieldSpec[] {
  const catalog = COMPONENT_CATALOG[node.type];
  const produces = catalog?.produces ?? null;
  // Non-producing nodes (ValidationError, HelperText, chrome, affordances)
  // REFERENCE a question's internal_field — e.g. a ValidationError carries it
  // as its error-slot binding (data-lg-error-for) — but never CLAIM an answer
  // name. They contribute NO field to the answer space, matching the F2
  // validator model (content-schema.ts:~758-764 scopes the internal_field
  // uniqueness universe to `catalog.produces !== null`). Skipping them stops a
  // later ValidationError{internal_field:"x"} from re-coercing the producer's
  // already-normalized value (e.g. a boolean back to the string "yes").
  if (produces === null) return [];
  const answerType: LeadgenAnswerType =
    node.answer_type ?? (produces as LeadgenAnswerType);

  // LeadGen Rework M7 (§6.8): a dual_range / from_to slider collects TWO sub-
  // fields {internal_field}_min / {internal_field}_max (each a number), exactly
  // like Address (§12.8) / NameFields sub-fields — so the field universe, rules
  // pickers and per-offer mapping see them. This only makes the ALREADY-migrated
  // content shape (NumberRangeQuestion + props.slider_type, M7) visible to
  // normalization; schema-side validation of the slider props is P2. single /
  // stepper / radial keep the single internal_field (the scalar branch below).
  if (
    node.type === "NumberRangeQuestion" &&
    isNonEmptyString(node.internal_field) &&
    (node.props?.["slider_type"] === "dual_range" || node.props?.["slider_type"] === "from_to")
  ) {
    const base = node.internal_field;
    return [`${base}_min`, `${base}_max`].map((field) => ({
      field,
      answerType: "number" as LeadgenAnswerType,
      hasDefault: false,
      defaultValue: undefined,
    }));
  }

  if (isNonEmptyString(node.internal_field)) {
    return [
      {
        field: node.internal_field,
        answerType,
        hasDefault: node.props?.["default"] !== undefined,
        defaultValue: node.props?.["default"],
        minCount: asFiniteNumber(node.props?.["min"]),
        maxCount: asFiniteNumber(node.props?.["max"]),
      },
    ];
  }
  if (node.type === "NameFieldsGroup") {
    const names = asStringArray(node.props?.["fields"], ["first", "last"]);
    return names.map((field) => ({ field, answerType: "string", hasDefault: false, defaultValue: undefined }));
  }
  if (node.type === "AddressAutocompleteQuestion") {
    const names = asStringArray(node.props?.["internal_fields"], ["street", "city", "state", "zip"]);
    return names.map((field) => ({ field, answerType: "string", hasDefault: false, defaultValue: undefined }));
  }
  if (node.type === "MultiQuestionGrid") {
    // P5 (PC-10): each ROW is its own enum answer field (over the row's pill
    // set) with an OPTIONAL default — the SAME 1→N expansion NameFieldsGroup/
    // Address use, so normalizeAnswers / the payload build / the auction facet
    // all see the rows as ordinary fields. The default seeds default_applied
    // exactly like any scalar `default` above.
    return readMultiQuestionRows(node).map((row) => ({
      field: row.internal_field,
      answerType: "enum" as LeadgenAnswerType,
      hasDefault: row.default !== undefined,
      defaultValue: row.default,
    }));
  }
  return [];
}

// ---------------------------------------------------------------------------
// normalizeAnswers — the §12.7 Section-level leg
// ---------------------------------------------------------------------------

export interface LeadgenNormalizedAnswers {
  // internal_field → normalized internal value (the §12.7 pivot).
  answers: Record<string, unknown>;
  // internal_field → §12.6 answer_source (analytics-quality provenance).
  sources: Record<string, LeadgenAnswerSource>;
}

// Normalize raw UI answers to the internal answer space, tracking answer_source
// (§12.6). Deterministic + pure: same content + raw answers → same output. A
// field whose raw value is invalid for its type (and has no usable default) is
// omitted (never fabricated as null/empty — the §12.11 "cleanObject drop"
// discipline starts here).
export function normalizeAnswers(
  content: LeadgenSectionContent,
  rawAnswers: LeadgenRawAnswers,
): LeadgenNormalizedAnswers {
  const answers: Record<string, unknown> = {};
  const sources: Record<string, LeadgenAnswerSource> = {};
  // §8.5 layout containers: walk the canonical flattened projection so a
  // question nested inside a container contributes its internal field exactly
  // like a top-level one (containers produce nothing and are skipped). Flat
  // legacy content flattens to itself.
  const components = flattenComponents(
    Array.isArray(content.components) ? content.components : [],
  );

  for (const node of components) {
    if (!isRecord(node)) continue;
    for (const spec of fieldsOf(node)) {
      const { value: rawValue, touched, present } = readRaw(rawAnswers[spec.field]);
      const normalizedDefault = spec.hasDefault
        ? normalizeAnswerValue(spec.defaultValue, spec.answerType)
        : undefined;

      let normalized: unknown;
      let source: LeadgenAnswerSource;

      if (present) {
        normalized = normalizeAnswerValue(rawValue, spec.answerType);
        if (touched) {
          // A touched value equal to the pre-set default is a CONFIRMED default.
          source =
            spec.hasDefault && normalized !== undefined && normalized === normalizedDefault
              ? "user_confirmed_default"
              : "user_selected";
        } else {
          // Echoed but untouched — the default rode along unchanged.
          source = spec.hasDefault ? "default_applied" : "user_selected";
        }
      } else if (spec.hasDefault) {
        normalized = normalizedDefault;
        source = "default_applied";
      } else {
        continue; // no answer + no default → contribute nothing
      }

      if (normalized === undefined) continue; // invalid raw / invalid default
      // Adversarial-review BLOCKER 2: an array-typed (MultiChoice) answer whose
      // SELECTION COUNT falls outside its authored min/max is invalid — the
      // SAME drop discipline as any other unusable value above (never a new
      // rejection channel). This is the RED LINE 3 server-side enforcement: a
      // scripted client posting straight to /lg/auction cannot bypass min/max
      // by skipping the browser's own (client-only) validateValue check.
      if (Array.isArray(normalized)) {
        const count = normalized.length;
        const tooFew = spec.minCount !== undefined && count < spec.minCount;
        const tooMany = spec.maxCount !== undefined && count > spec.maxCount;
        if (tooFew || tooMany) continue;
      }
      answers[spec.field] = normalized;
      sources[spec.field] = source;
    }
  }

  return { answers, sources };
}

// ---------------------------------------------------------------------------
// v3.1 §9 (S3-6) — the auction LOCATION FACET seam.
//
// The §9 "Use in auction rules" job turns a submitted ZIP into a location the
// auction can target/exclude by state, city or ZIP. This is the PURE derivation
// seam: it enumerates the Maps auction/validate ZIP-family fields and builds the
// facet from the already-normalized answers (deriveLocationFacet, maps.ts, is
// the primitive). The ASYNC server-side validate leg (S3-5 — the geocode / KV
// enrichment + the invalid-ZIP drop) runs in serve-auction.ts and passes its
// per-field {city,state} enrichment in here; WITHOUT the server key that
// enrichment is absent, so the facet is ZIP-ONLY (the §9.3 documented
// degradation). The auction ENGINE is untouched beyond the single middle-tier
// merge (engine.ts) — this seam never evaluates or mutates a rule.
// ---------------------------------------------------------------------------

// The ZIP-family internal field a Maps-eligible node contributes its ZIP answer
// under: ZIPInputQuestion → its own internal_field; AddressAutocompleteQuestion
// → its `zip` sub-field (the §12.8 distinct-internal-fields default). null for
// any other node (only ZIP/Address carry a Maps job).
function mapsZipFieldOf(node: LeadgenComponentNode): string | null {
  if (node.type === "ZIPInputQuestion") {
    return isNonEmptyString(node.internal_field) ? node.internal_field : null;
  }
  if (node.type === "AddressAutocompleteQuestion") {
    const subs = asStringArray(node.props?.["internal_fields"], ["street", "city", "state", "zip"]);
    return subs.includes("zip") ? "zip" : (subs[subs.length - 1] ?? null);
  }
  return null;
}

// One Maps-eligible ZIP-family field carrying a validate and/or auction job.
export interface LeadgenMapsAuctionField {
  // The internal field holding this node's ZIP answer.
  zipField: string;
  // mapsJobsFor(node) — the §9.3 per-field precedence result.
  validate: boolean;
  auction: boolean;
}

// Enumerate the Maps auction/validate ZIP-family fields in a Section (§9 field
// Maps tab). Pure — the caller reads the normalized ZIP value + runs the async
// validate leg. flattenComponents so a field nested in a §8.5 container is found
// exactly like a top-level one.
export function collectMapsAuctionFields(content: LeadgenSectionContent): LeadgenMapsAuctionField[] {
  const out: LeadgenMapsAuctionField[] = [];
  const components = flattenComponents(Array.isArray(content.components) ? content.components : []);
  for (const node of components) {
    if (!isRecord(node)) continue;
    const zipField = mapsZipFieldOf(node);
    if (zipField === null) continue;
    const jobs = mapsJobsFor(node);
    if (!jobs.validate && !jobs.auction) continue;
    out.push({ zipField, validate: jobs.validate, auction: jobs.auction });
  }
  return out;
}

// The server-side validate-leg enrichment for one field (city/state resolved by
// a geocode / KV hit). Absent ⇒ the facet is ZIP-only (§9.3).
export interface LeadgenMapsFieldEnrichment {
  city?: string;
  state?: string;
}

// Derive the §9 auction location facet from a Section's normalized answers + the
// optional server-side validate enrichment. For each field with the auction job,
// take its normalized ZIP answer and build the facet via deriveLocationFacet —
// enriched with the field's state/city when the validate leg ran (else ZIP-only,
// the documented no-key degradation). The FIRST auction field that resolves a
// valid ZIP wins (a funnel targets one location). Pure; null when no auction
// field resolves a ZIP (⇒ the engine merges {}, byte-identical to pre-facet).
export function deriveAuctionFacet(
  content: LeadgenSectionContent,
  normalizedAnswers: Readonly<Record<string, unknown>>,
  enrichmentByField?: Readonly<Record<string, LeadgenMapsFieldEnrichment>>,
): LeadgenLocationFacet | null {
  for (const f of collectMapsAuctionFields(content)) {
    if (!f.auction) continue;
    const zipVal = normalizedAnswers[f.zipField];
    if (typeof zipVal !== "string") continue;
    const enr = enrichmentByField?.[f.zipField];
    const facet =
      enr !== undefined
        ? deriveLocationFacet({ street: "", city: enr.city ?? "", state: enr.state ?? "", zip: zipVal })
        : deriveLocationFacet(zipVal);
    if (facet !== null) return facet;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-Offer leg (§12.11): answer maps → payload nodes → buildPayload
// ---------------------------------------------------------------------------

// One resolved answer-map edge (the parsed runtime shape of a
// leadgen_section_answer_maps row). `output_value_map`/`value_transform` are
// already parsed from their *_json columns by the caller.
export interface LeadgenAnswerMapping {
  internal_field: string;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map?: Record<string, unknown> | null;
  value_transform?: LeadgenTransformStep[] | null;
  required_for_offer?: boolean;
  default_value?: unknown;
  fallback_value?: unknown;
  // Enum domain (when the provider field is an enum) — membership is enforced
  // by buildPayload against valid_values.
  valid_values?: unknown[];
}

// provider_expected_type → a payload node type. Unknown/absent falls to
// "string" (the least-committal provider shape; anything stringifies).
export function providerNodeType(providerExpectedType: string): LeadgenPayloadNodeType {
  return NODE_TYPE_SET.has(providerExpectedType)
    ? (providerExpectedType as LeadgenPayloadNodeType)
    : "string";
}

// Turn one answer-map edge into a source:"answer" payload node. The dotted
// field path implies nesting exactly as the §11.5 normative schema shape does.
export function answerMappingToNode(mapping: LeadgenAnswerMapping): LeadgenPayloadNode {
  const segments = mapping.offer_payload_field_path.split(".");
  const name = segments[segments.length - 1] ?? mapping.offer_payload_field_path;
  const map = isRecord(mapping.output_value_map) ? mapping.output_value_map : undefined;
  const transform =
    Array.isArray(mapping.value_transform) && mapping.value_transform.length > 0
      ? mapping.value_transform
      : undefined;
  return {
    path: mapping.offer_payload_field_path,
    name,
    type: providerNodeType(mapping.provider_expected_type),
    required: mapping.required_for_offer === true,
    valid_values: Array.isArray(mapping.valid_values) ? mapping.valid_values : undefined,
    default: mapping.default_value,
    fallback: mapping.fallback_value,
    source: "answer",
    internal_field: mapping.internal_field,
    value_map: map,
    transform,
  };
}

// Build ONE Offer's provider payload from its answer-map edges + the
// already-normalized internal answers. This is the §12.11 per-Offer leg,
// delegated in full to buildPayload (value_map → value_transform →
// provider_expected_type coercion → default/fallback → cleanObject) so the
// per-Offer semantics are byte-for-byte the runtime payload builder's.
export function buildOfferPayload(
  mappings: readonly LeadgenAnswerMapping[],
  normalizedAnswers: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const schema: LeadgenPayloadSchema = {
    version: 1,
    root: { type: "object", children: mappings.map(answerMappingToNode) },
  };
  return buildPayload(schema, { answers: normalizedAnswers });
}

// Convenience end-to-end: raw UI answers + one Offer's maps → that Offer's
// payload. Runs both legs (§12.11 full order) for callers that hold raw UI
// answers (the /validate-payload preview + tests).
export function generateOfferPayload(
  content: LeadgenSectionContent,
  rawAnswers: LeadgenRawAnswers,
  mappings: readonly LeadgenAnswerMapping[],
): { answers: Record<string, unknown>; sources: Record<string, LeadgenAnswerSource>; payload: Record<string, unknown> } {
  const normalized = normalizeAnswers(content, rawAnswers);
  return {
    answers: normalized.answers,
    sources: normalized.sources,
    payload: buildOfferPayload(mappings, normalized.answers),
  };
}
