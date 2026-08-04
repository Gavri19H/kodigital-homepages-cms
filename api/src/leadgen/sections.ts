// LeadGen Section domain logic (contract 05 §12.1/§12.4/§12.11 + §35.1).
// PURE — no DB access; every referential check takes injected Offer/schema
// info, exactly like leadgen/validation.ts keeps its validators pure and lets
// the Stage-B handlers feed the DB findings in. Four jobs:
//
//   validateSection(raw)          — §12.1 scalar fields + content via the
//                                   Stage-A validateSectionContent (§14.8
//                                   curated-override check for the Section-
//                                   level design_overrides bag too).
//   validateMappingReferences()   — §12.4 "mapping into an archived / mismatched
//                                   Offer is blocked at save" (+ an Offer with
//                                   no active payload schema can't be pinned).
//   rebuildDerivedIndexes()       — §12.1 "server rebuilds section_offers +
//                                   section_answer_maps from content_json": the
//                                   leadgen_section_available_offers +
//                                   leadgen_section_answer_maps rows to persist.
//   mappingCompleteness()         — §12.11 per-edge complete | missing_required
//                                   | type_mismatch | orphaned.
//   sectionValidationStatus()     — §12.11 "a Section with any error row cannot
//                                   be included in a published Quote".
//
// mapping_status COLUMN note: the 0036 DDL CHECK is
// ('complete','incomplete','type_mismatch','orphaned') while §12.11 names the
// derived UI states ('complete','missing_required','type_mismatch','orphaned').
// mappingCompleteness() returns the §12.11 semantic; the DDL-storable value is
// toMappingStatusColumn() (missing_required → incomplete).

import {
  CURATED_DESIGN_OVERRIDE_KEYS,
  LEADGEN_THEME_ROLES,
  flattenComponents,
  // The operator's own name for a style control ("Default answer-grid gap"),
  // so a save error never prints the stored key id at a person.
  leadgenControlLabel,
  validateSectionContent,
  type LeadgenSectionContent,
  type SectionContentError,
} from "../public/leadgen/components/content-schema";
import type { Problem } from "../public/leadgen/designs/theme";
import { providerNodeType } from "./answers";
import type { FieldErrors } from "./validation";
import type { LeadgenPayloadNodeType, LeadgenTransformStep } from "./payload";
import type {
  LeadgenContinueMode,
  LeadgenMappingState,
  LeadgenMappingStatus,
  LeadgenSectionStatus,
  LeadgenValidationStatus,
} from "../admin/leadgen/db-types";

// ---------------------------------------------------------------------------
// small local helpers (the validation.ts private idiom)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asToggle(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === 1) return true;
  if (value === 0) return false;
  return null;
}

// Rejects CSS-injection punctuation AND the HTML-attribute breakout quotes
// (" ' `) — §14.10 no-arbitrary-CSS. MUST stay byte-identical to the copy in
// src/public/leadgen/components/content-schema.ts.
const CSS_ESCAPE_RE = /[;{}<>()"'`\\]|url\(|expression|@import|\/\*/i;
const CURATED_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);

// --- v2.5 09 §9.5 Section-level layer-4 override keys (Phase C) --------------
// `design_overrides_json` additionally accepts the sparse §9.5 shape:
//   palette?        role → role-or-#hex map over the 14 §9.1 roles
//   columnsDefault? integer 1..5 (Round-4 A-7: the presets' renderCardGrid
//                   clampInt range, widened from 2..5 to offer the 1-column
//                   "stack" preset — P1b widened the renderer + per-node
//                   content-schema clamps; this Section-level default seam
//                   was the P1c leg, row R4-41)
//   gapDefault?     fixed spacing-token value (never arbitrary CSS)
// The renderer side already consumes them (config-dto parseSectionDesignOverrides
// → presets layer 4); this is the WRITER that was blocked by the curated-key
// check below. Unknown keys — top-level and palette roles — stay rejected with
// path-precise field errors.
const SECTION_LEVEL_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "palette",
  "columnsDefault",
  "gapDefault",
]);
const THEME_ROLE_SET: ReadonlySet<string> = new Set(LEADGEN_THEME_ROLES);
// MUST stay byte-identical to LEGACY_HEX_RE in content-schema.ts (§9.4 value
// vocabulary: known role OR raw #hex literal).
const LEGACY_HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
// The presets clamp answer-grid columns to 1..5 (renderCardGrid clampInt,
// widened Round-4 A-7 to offer the 1-column "stack" preset) — the save gate
// accepts exactly the renderable range.
const SECTION_COLUMNS_MIN = 1;
const SECTION_COLUMNS_MAX = 5;

// Validate the §9.5 `palette` map into `errors` (path-precise per role).
// The messages are read by an operator in the save banner, so they name the
// control and end on the action — the §9.5 cite lives in this comment.
function validateSectionPaletteOverride(value: unknown, errors: FieldErrors): void {
  if (!isRecord(value)) {
    errors["design_overrides.palette"] =
      "The palette must give each theme colour role a role or a #hex colour. Set the palette again from the Design tab.";
    return;
  }
  for (const [role, entry] of Object.entries(value)) {
    if (!THEME_ROLE_SET.has(role)) {
      errors[`design_overrides.palette.${role}`] =
        `'${role}' is not a theme colour role. Use one of: ${LEADGEN_THEME_ROLES.join(", ")}.`;
    } else if (typeof entry !== "string" || (!THEME_ROLE_SET.has(entry) && !LEGACY_HEX_RE.test(entry))) {
      errors[`design_overrides.palette.${role}`] =
        `The palette entry for '${role}' must be a theme colour role (${LEADGEN_THEME_ROLES.join(", ")}) or a #hex colour like #1A2B3C. Pick a role, or enter a hex value.`;
    }
  }
}

// Validate one §9.5 section-level key into `errors`. Caller guarantees the key
// is a member of SECTION_LEVEL_OVERRIDE_KEYS.
function validateSectionLevelOverride(key: string, value: unknown, errors: FieldErrors): void {
  if (key === "palette") {
    validateSectionPaletteOverride(value, errors);
    return;
  }
  if (key === "columnsDefault") {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < SECTION_COLUMNS_MIN ||
      value > SECTION_COLUMNS_MAX
    ) {
      errors["design_overrides.columnsDefault"] =
        `Columns must be between ${SECTION_COLUMNS_MIN} and ${SECTION_COLUMNS_MAX}`;
    }
    return;
  }
  // gapDefault — a fixed spacing token (the design spacing scale values), the
  // same §14.10 no-arbitrary-CSS rule the per-node gridGap value passes.
  if (typeof value !== "string" || value.trim() === "") {
    errors["design_overrides.gapDefault"] =
      `'${leadgenControlLabel("gapDefault")}' must be one of the theme's spacing values. Pick one from the Design tab.`;
  } else if (CSS_ESCAPE_RE.test(value)) {
    errors["design_overrides.gapDefault"] =
      `'${leadgenControlLabel("gapDefault")}' must be one of the theme's spacing values, not arbitrary CSS. Pick one from the Design tab.`;
  }
}

// Round-4 A-8/P-9 (rows R4-13/R4-42): a display-name map so validateSection's
// save-error MESSAGES read as plain operator language, never the raw field id
// verbatim ("section_name is required" -> "Section name is required"). The
// `fields` object's KEYS stay the raw ids unchanged (the studio maps/links by
// key, P1a) -- only the human-readable message text changes. P8-5 F2
// (verified against ui-section-studio.ts): the client's renderSaveFieldErrors
// no longer runs a display-name/humanizer fallback of its own — it prints
// this message text verbatim, prefixed only with a row-identity label built
// from the resolved node's/choice's own real data (props.label /
// internal_field / type, or a choice's label/value). This map is what turns
// the raw id into that text in the first place.
const FIELD_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  section_name: "Section name",
  activity: "Activity",
  vertical: "Vertical",
  headline_text: "Headline",
  subheadline_text: "Subheadline",
  image_json: "Image",
  content_json: "Content",
  continue_mode: "Continue mode",
  address_validation_enabled: "Address validation",
  status: "Status",
  design_overrides_json: "Design overrides",
};

// ---------------------------------------------------------------------------
// §12.1 create/update — scalar fields + content validation
// ---------------------------------------------------------------------------

export interface LeadgenSectionInput {
  section_name: string;
  activity: string;
  vertical: string;
  headline_text: string;
  subheadline_text: string | null;
  image_json: string | null;
  content: LeadgenSectionContent;
  content_json: string;
  continue_mode: LeadgenContinueMode;
  design_overrides_json: string | null;
  address_validation_enabled: boolean;
  status: LeadgenSectionStatus;
}

export interface LeadgenSectionValidationResult {
  errors: FieldErrors;
  value: LeadgenSectionInput | null;
  // FIX 5 (03 §3.6 + 08 §8.6): the content validator's NON-BLOCKING warnings
  // (frame_scope_component / duplicate_continue), projected to the shared
  // Problem shape — path-precise, scope "component" for a `components[…]`
  // path, "section" otherwise. Empty on a blocked save (`value === null`);
  // the handlers thread it into the PATCH/POST success response as
  // `problems[]` so a save is never silently warning-swallowing.
  problems: Problem[];
}

// Project one content-validator warning to the 03 §3.6 Problem shape.
function contentWarningToProblem(warning: SectionContentError): Problem {
  return {
    path: warning.path,
    scope: warning.path.startsWith("components[") ? "component" : "section",
    severity: "warning",
    message: warning.message,
  };
}

// Parse a `content_json` value that arrived as either a JSON string or an
// already-parsed object. Returns the parsed object or a typed error string.
function parseContentJson(raw: unknown): { content: unknown } | string {
  if (typeof raw === "string") {
    if (raw.trim() === "") return `${FIELD_DISPLAY_NAMES.content_json} is required`;
    try {
      return { content: JSON.parse(raw) as unknown };
    } catch {
      return `${FIELD_DISPLAY_NAMES.content_json} must be valid JSON`;
    }
  }
  if (isRecord(raw)) return { content: raw };
  return `${FIELD_DISPLAY_NAMES.content_json} is required`;
}

// Validate a create/update Section body (§12.1 + §35.1 Section rules).
// Required: section_name, activity, vertical, headline_text, and a content
// body that passes the Stage-A validateSectionContent (≥1 component, each
// question well-formed). PURE — Offer referential checks are
// validateMappingReferences's job.
export function validateSection(raw: unknown): LeadgenSectionValidationResult {
  const errors: FieldErrors = {};
  const problems: Problem[] = [];
  if (!isRecord(raw)) {
    return { errors: { body: "request body must be a JSON object" }, value: null, problems: [] };
  }

  const sectionName = trimmedString(raw["section_name"]);
  if (sectionName === null) errors["section_name"] = `${FIELD_DISPLAY_NAMES.section_name} is required`;
  const activity = trimmedString(raw["activity"]);
  if (activity === null) errors["activity"] = `${FIELD_DISPLAY_NAMES.activity} is required`;
  const vertical = trimmedString(raw["vertical"]);
  if (vertical === null) errors["vertical"] = `${FIELD_DISPLAY_NAMES.vertical} is required`;
  const headline = trimmedString(raw["headline_text"]);
  if (headline === null) errors["headline_text"] = `${FIELD_DISPLAY_NAMES.headline_text} is required`;

  // subheadline: optional string | null.
  let subheadline: string | null = null;
  if (raw["subheadline_text"] !== undefined && raw["subheadline_text"] !== null) {
    subheadline = trimmedString(raw["subheadline_text"]);
    if (subheadline === null) {
      errors["subheadline_text"] = `${FIELD_DISPLAY_NAMES.subheadline_text} must be a non-empty string or null`;
    }
  }

  // image_json: optional; a provided object serializes, a provided string must
  // be valid JSON (stored as-is).
  let imageJson: string | null = null;
  const rawImage = raw["image_json"] ?? raw["image"];
  if (rawImage !== undefined && rawImage !== null) {
    if (isRecord(rawImage)) {
      imageJson = JSON.stringify(rawImage);
    } else if (typeof rawImage === "string" && rawImage.trim() !== "") {
      try {
        JSON.parse(rawImage);
        imageJson = rawImage;
      } catch {
        errors["image_json"] = `${FIELD_DISPLAY_NAMES.image_json} must be valid JSON`;
      }
    } else {
      errors["image_json"] = `${FIELD_DISPLAY_NAMES.image_json} must be an object or JSON string`;
    }
  }

  // continue_mode (§12.5), default 'button'.
  let continueMode: LeadgenContinueMode = "button";
  if (raw["continue_mode"] !== undefined && raw["continue_mode"] !== null) {
    const cm = raw["continue_mode"];
    if (cm === "button" || cm === "auto_advance") continueMode = cm;
    else errors["continue_mode"] = `${FIELD_DISPLAY_NAMES.continue_mode} must be one of button|auto_advance`;
  }

  // address_validation_enabled (§12.8) toggle, default false.
  let addressValidation = false;
  if (raw["address_validation_enabled"] !== undefined && raw["address_validation_enabled"] !== null) {
    const toggled = asToggle(raw["address_validation_enabled"]);
    if (toggled === null) {
      errors["address_validation_enabled"] = `${FIELD_DISPLAY_NAMES.address_validation_enabled} must be a boolean`;
    } else addressValidation = toggled;
  }

  // status, default 'active'.
  let status: LeadgenSectionStatus = "active";
  if (raw["status"] !== undefined && raw["status"] !== null) {
    const s = raw["status"];
    if (s === "active" || s === "archived") status = s;
    else errors["status"] = `${FIELD_DISPLAY_NAMES.status} must be one of active|archived`;
  }

  // design_overrides_json (§14.8 + v2.5 09 §9.5): Section-level token bag —
  // the curated per-node keys (unchanged) PLUS the §9.5 layer-4 shape
  // ({palette?, columnsDefault?, gapDefault?}). Unknown keys stay rejected;
  // never arbitrary CSS.
  let designOverridesJson: string | null = null;
  const rawOverrides = raw["design_overrides_json"] ?? raw["design_overrides"];
  if (rawOverrides !== undefined && rawOverrides !== null) {
    let parsed: unknown = rawOverrides;
    if (typeof rawOverrides === "string") {
      try {
        parsed = JSON.parse(rawOverrides) as unknown;
      } catch {
        errors["design_overrides_json"] = `${FIELD_DISPLAY_NAMES.design_overrides_json} must be valid JSON`;
        parsed = undefined;
      }
    }
    if (parsed !== undefined) {
      if (!isRecord(parsed)) {
        errors["design_overrides_json"] =
          `${FIELD_DISPLAY_NAMES.design_overrides_json} must be an object of curated token keys`;
      } else {
        for (const [key, val] of Object.entries(parsed)) {
          if (SECTION_LEVEL_OVERRIDE_KEYS.has(key)) {
            validateSectionLevelOverride(key, val, errors);
          } else if (!CURATED_OVERRIDE_KEY_SET.has(key)) {
            // §14.8 curated-key vocabulary, said in the operator's words.
            errors[`design_overrides.${key}`] =
              `'${key}' is not a style setting you can override. Remove it — the Design tab lists the settings this Section supports.`;
          } else if (typeof val === "string" && CSS_ESCAPE_RE.test(val)) {
            // §14.10 no arbitrary CSS.
            errors[`design_overrides.${key}`] =
              `'${leadgenControlLabel(key)}' must be one of the theme's values, not arbitrary CSS. Pick a value from the Design tab.`;
          }
        }
        const hasOverrideError = Object.keys(errors).some((k) => k.startsWith("design_overrides"));
        if (!hasOverrideError) designOverridesJson = JSON.stringify(parsed);
      }
    }
  }

  // content_json → validateSectionContent (§12.3 / §13.1 / §14.8).
  let content: LeadgenSectionContent | null = null;
  let contentJson = "";
  const parsedContent = parseContentJson(raw["content_json"] ?? raw["content"]);
  if (typeof parsedContent === "string") {
    errors["content_json"] = parsedContent;
  } else {
    // P4a (PC-A1): pass the section's continue_mode so the validator can reject
    // an auto_advance composition the engine could never advance (stuck funnel).
    const verdict = validateSectionContent(parsedContent.content, continueMode);
    if (!verdict.ok) {
      // Surface each content error under its field path so the editor can pin
      // it to the offending component.
      for (const err of verdict.errors) {
        errors[`content.${err.path}`] = err.message;
      }
    } else {
      content = parsedContent.content as LeadgenSectionContent;
      contentJson = JSON.stringify(content);
      // FIX 5: the validator's non-blocking warnings ride the result as §3.6
      // problems (a warning never blocks — `ok` is errors-keyed).
      for (const warning of verdict.warnings) {
        problems.push(contentWarningToProblem(warning));
      }
    }
  }

  if (Object.keys(errors).length > 0 || content === null) return { errors, value: null, problems: [] };
  return {
    errors,
    problems,
    value: {
      section_name: sectionName as string,
      activity: activity as string,
      vertical: vertical as string,
      headline_text: headline as string,
      subheadline_text: subheadline,
      image_json: imageJson,
      content,
      content_json: contentJson,
      continue_mode: continueMode,
      design_overrides_json: designOverridesJson,
      address_validation_enabled: addressValidation,
      status,
    },
  };
}

// ---------------------------------------------------------------------------
// §12.4 mapping-reference guards (archived / mismatched Offer blocked at save)
// ---------------------------------------------------------------------------

// The injected per-Offer info the referential checks + completeness derivation
// need. `fieldTypes` maps every payload field path in the Offer's ACTIVE schema
// to its declared node type; `requiredFieldPaths` are the required ones (§35.1
// "provider-required fields mapped before Quote publish").
export interface OfferSchemaInfo {
  status: string;
  activity: string;
  vertical: string;
  active_schema_id: number | null;
  active_schema_public_id: string | null;
  fieldTypes: ReadonlyMap<string, LeadgenPayloadNodeType>;
  requiredFieldPaths: readonly string[];
}

// One resolved answer-map edge (offer_id already resolved to the numeric id).
export interface LeadgenAnswerMapEdge {
  question_id: string;
  question_key: string;
  internal_field: string;
  answer_type: string;
  offer_id: number;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map: Record<string, unknown> | null;
  value_transform: LeadgenTransformStep[] | null;
  required_for_offer: boolean;
  default_value: string | null;
  fallback_value: string | null;
}

// §12.4/§35: mapping into an archived / paused Offer, or an Offer whose
// activity+vertical mismatch the Section, or an Offer with no active payload
// schema (nowhere to pin payload_schema_id — a NOT NULL FK), is BLOCKED at
// save. Field-keyed by the edge index. `offersById` is injected by the handler.
export function validateMappingReferences(
  section: { activity: string; vertical: string },
  edges: readonly LeadgenAnswerMapEdge[],
  offersById: ReadonlyMap<number, OfferSchemaInfo>,
): FieldErrors {
  const errors: FieldErrors = {};
  edges.forEach((edge, index) => {
    const base = `answer_maps[${index}]`;
    const offer = offersById.get(edge.offer_id);
    if (offer === undefined) {
      errors[`${base}.offer_id`] = `unknown offer id ${edge.offer_id}`;
      return;
    }
    if (offer.status !== "active") {
      errors[`${base}.offer_id`] =
        `This Offer is ${offer.status} — a mapping can only send answers to an active Offer. Pick an active Offer, or activate this one.`;
      return;
    }
    if (offer.activity !== section.activity || offer.vertical !== section.vertical) {
      errors[`${base}.offer_id`] =
        `This Offer is for ${offer.activity} / ${offer.vertical}, which does not match the Section's ${section.activity} / ${section.vertical}. Pick an Offer for ${section.activity} / ${section.vertical}.`;
      return;
    }
    if (offer.active_schema_id === null) {
      errors[`${base}.offer_id`] =
        "This Offer has no active payload schema, so there is nothing to map answers into. Publish a payload schema on the Offer first.";
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// §12.11 per-edge mapping completeness
// ---------------------------------------------------------------------------

// The §12.11 derived states. The DDL-storable value is toMappingStatusColumn().
export type LeadgenMappingCompleteness = "complete" | "missing_required" | "type_mismatch" | "orphaned";

// The normalized answer_type → the payload node type it produces natively.
function answerTypeNodeType(answerType: string): LeadgenPayloadNodeType {
  switch (answerType) {
    case "currency":
      return "number";
    case "number":
    case "boolean":
    case "enum":
    case "array":
    case "object":
    case "string":
      return answerType;
    default:
      return "string";
  }
}

// Without a value_map/transform, can the raw normalized answer coerce to the
// schema node's declared type? (payload.ts coerceToType semantics.)
function answerCoercible(answerType: string, nodeType: LeadgenPayloadNodeType): boolean {
  if (nodeType === "string") return true; // anything stringifies
  if (nodeType === "enum") return true; // membership is the valid_values check, not the type
  return answerTypeNodeType(answerType) === nodeType;
}

// §12.11 per-edge completeness against the Offer's ACTIVE schema.
//   orphaned       — the field path no longer exists in the active schema vN
//                    (or the Offer has no active schema).
//   type_mismatch  — the edge's provider type disagrees with the schema node,
//                    or the answer_type is not coercible (no map/transform).
//   missing_required — a provider-required edge with no bound internal_field.
//   complete       — field exists, types line up, mapping fully specified.
export function mappingCompleteness(
  edge: LeadgenAnswerMapEdge,
  offerSchema: OfferSchemaInfo | null,
): LeadgenMappingCompleteness {
  if (offerSchema === null || offerSchema.active_schema_id === null) return "orphaned";
  const nodeType = offerSchema.fieldTypes.get(edge.offer_payload_field_path);
  if (nodeType === undefined) return "orphaned";

  // The edge must agree with the schema about the field's declared type.
  if (providerNodeType(edge.provider_expected_type) !== nodeType) return "type_mismatch";

  const hasMap = isRecord(edge.output_value_map) && Object.keys(edge.output_value_map).length > 0;
  const hasTransform = Array.isArray(edge.value_transform) && edge.value_transform.length > 0;
  if (!hasMap && !hasTransform && !answerCoercible(edge.answer_type, nodeType)) {
    return "type_mismatch";
  }

  if (edge.required_for_offer && trimmedString(edge.internal_field) === null) {
    return "missing_required";
  }
  return "complete";
}

// §12.11 UI semantic → the 0036 DDL-storable mapping_status enum.
export function toMappingStatusColumn(completeness: LeadgenMappingCompleteness): LeadgenMappingStatus {
  return completeness === "missing_required" ? "incomplete" : completeness;
}

// A single edge is `ok` only when it is complete; every other state (including
// missing_required) is an `error` row that blocks Quote publish (§12.11/§35.1).
export function edgeValidationStatus(completeness: LeadgenMappingCompleteness): LeadgenValidationStatus {
  return completeness === "complete" ? "ok" : "error";
}

// ---------------------------------------------------------------------------
// §12.1 derived-index rebuild (server rebuilds from content_json)
// ---------------------------------------------------------------------------

export interface RebuiltAnswerMapRow {
  question_id: string;
  question_key: string;
  internal_field: string;
  answer_type: string;
  offer_id: number;
  payload_schema_id: number | null;
  payload_schema_public_id: string | null;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map: Record<string, unknown> | null;
  value_transform: LeadgenTransformStep[] | null;
  required_for_offer: boolean;
  default_value: string | null;
  fallback_value: string | null;
  mapping_completeness: LeadgenMappingCompleteness;
  mapping_status: LeadgenMappingStatus;
  validation_status: LeadgenValidationStatus;
}

export interface RebuiltAvailableOfferRow {
  offer_id: number;
  selected: boolean;
  mapping_state: LeadgenMappingState;
  required_fields_total: number;
  required_fields_mapped: number;
}

export interface RebuildResult {
  answerMaps: RebuiltAnswerMapRow[];
  availableOffers: RebuiltAvailableOfferRow[];
}

export interface RebuildInput {
  content: LeadgenSectionContent;
  answerMaps: readonly LeadgenAnswerMapEdge[];
  offerSchemas: ReadonlyMap<number, OfferSchemaInfo>;
  selectedOfferIds?: ReadonlySet<number>;
}

// §12.1 "on save the server rebuilds leadgen_section_available_offers +
// leadgen_section_answer_maps from content_json" — the derived index can never
// drift from the authored Section state. Pure: the caller persists the rows in
// one replace-set batch (delete-all + reinsert). `content` gates the edges to
// question_ids that actually exist in the body (a stale edge is dropped).
export function rebuildDerivedIndexes(input: RebuildInput): RebuildResult {
  const knownQuestionIds = new Set<string>();
  // §8.5 layout containers: the mappable question universe is the canonical
  // flattened projection — an answer map bound to a question nested inside a
  // container survives the rebuild; container nodes themselves are NOT
  // mappable question_ids (they produce nothing). Flat content is unchanged.
  const components = flattenComponents(
    Array.isArray(input.content.components) ? input.content.components : [],
  );
  for (const node of components) {
    if (isRecord(node) && typeof node["question_id"] === "string") {
      knownQuestionIds.add(node["question_id"]);
    }
  }

  const answerMaps: RebuiltAnswerMapRow[] = [];
  for (const edge of input.answerMaps) {
    // A mapping whose source question no longer exists in content_json is
    // dropped (the rebuild is derived FROM content — §12.1).
    if (!knownQuestionIds.has(edge.question_id)) continue;
    const offerSchema = input.offerSchemas.get(edge.offer_id) ?? null;
    const completeness = mappingCompleteness(edge, offerSchema);
    answerMaps.push({
      ...edge,
      payload_schema_id: offerSchema?.active_schema_id ?? null,
      payload_schema_public_id: offerSchema?.active_schema_public_id ?? null,
      mapping_completeness: completeness,
      mapping_status: toMappingStatusColumn(completeness),
      validation_status: edgeValidationStatus(completeness),
    });
  }

  // Group edges by offer to derive leadgen_section_available_offers.
  const byOffer = new Map<number, RebuiltAnswerMapRow[]>();
  for (const row of answerMaps) {
    const list = byOffer.get(row.offer_id);
    if (list === undefined) byOffer.set(row.offer_id, [row]);
    else list.push(row);
  }

  const availableOfferIds = new Set<number>([...byOffer.keys()]);
  if (input.selectedOfferIds !== undefined) {
    for (const id of input.selectedOfferIds) availableOfferIds.add(id);
  }

  const availableOffers: RebuiltAvailableOfferRow[] = [];
  for (const offerId of availableOfferIds) {
    const edges = byOffer.get(offerId) ?? [];
    const offerSchema = input.offerSchemas.get(offerId) ?? null;
    const requiredTotal = offerSchema?.requiredFieldPaths.length ?? 0;
    const requiredSet = new Set(offerSchema?.requiredFieldPaths ?? []);
    const mappedRequired = new Set<string>();
    let hasHardError = false;
    for (const edge of edges) {
      if (edge.mapping_completeness === "type_mismatch" || edge.mapping_completeness === "orphaned") {
        hasHardError = true;
      }
      if (edge.mapping_completeness === "complete" && requiredSet.has(edge.offer_payload_field_path)) {
        mappedRequired.add(edge.offer_payload_field_path);
      }
    }
    const requiredMapped = mappedRequired.size;

    let state: LeadgenMappingState;
    if (edges.length === 0) state = "selected";
    else if (hasHardError) state = "invalid";
    else if (requiredMapped < requiredTotal) state = "incomplete";
    else state = "complete";

    availableOffers.push({
      offer_id: offerId,
      selected: input.selectedOfferIds !== undefined ? input.selectedOfferIds.has(offerId) : edges.length > 0,
      mapping_state: state,
      required_fields_total: requiredTotal,
      required_fields_mapped: requiredMapped,
    });
  }

  // Deterministic order: available offers by offer_id.
  availableOffers.sort((a, b) => a.offer_id - b.offer_id);
  return { answerMaps, availableOffers };
}

// ---------------------------------------------------------------------------
// §12.11 / §35.1 publish gate
// ---------------------------------------------------------------------------

export interface OfferValidationVerdict {
  offer_id: number;
  mapping_state: LeadgenMappingState;
  validation_status: LeadgenValidationStatus;
  reasons: string[];
}

export interface SectionValidationVerdict {
  status: LeadgenValidationStatus;
  publishable: boolean;
  offers: OfferValidationVerdict[];
}

// §12.11: "a Section with any error row cannot be included in a published
// Quote." An Offer is in error when it carries a hard error edge
// (type_mismatch/orphaned) OR a provider-required field is unmapped (§35.1).
// An Offer with 0 required fields + no errors is publishable even if nothing
// is mapped.
export function sectionValidationStatus(result: RebuildResult): SectionValidationVerdict {
  const edgesByOffer = new Map<number, RebuiltAnswerMapRow[]>();
  for (const row of result.answerMaps) {
    const list = edgesByOffer.get(row.offer_id);
    if (list === undefined) edgesByOffer.set(row.offer_id, [row]);
    else list.push(row);
  }

  const offers: OfferValidationVerdict[] = [];
  let anyError = false;
  for (const available of result.availableOffers) {
    const edges = edgesByOffer.get(available.offer_id) ?? [];
    const reasons: string[] = [];
    for (const edge of edges) {
      if (edge.mapping_completeness === "type_mismatch") {
        reasons.push(`${edge.offer_payload_field_path}: answer type not coercible to ${edge.provider_expected_type}`);
      } else if (edge.mapping_completeness === "orphaned") {
        reasons.push(`${edge.offer_payload_field_path}: field no longer exists in the active Offer schema`);
      } else if (edge.mapping_completeness === "missing_required") {
        reasons.push(`${edge.offer_payload_field_path}: required field is not fully mapped`);
      }
    }
    if (available.required_fields_mapped < available.required_fields_total) {
      reasons.push(
        `${available.required_fields_total - available.required_fields_mapped} required provider field(s) unmapped`,
      );
    }
    const validation: LeadgenValidationStatus = reasons.length === 0 ? "ok" : "error";
    if (validation === "error") anyError = true;
    offers.push({
      offer_id: available.offer_id,
      mapping_state: available.mapping_state,
      validation_status: validation,
      reasons,
    });
  }

  const status: LeadgenValidationStatus = anyError ? "error" : "ok";
  return { status, publishable: !anyError, offers };
}
