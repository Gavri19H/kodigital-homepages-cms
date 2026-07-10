// LeadGen Sections admin API — the full contract 03 §8.2 Sections block
// (Phase-5 Stage B). Registered from router.ts, so the Cloudflare Access gate
// + ADMIN_HOST 404 wall + no-store headers apply unchanged (03 §8.1).
//
// Conventions (03 §8.4/§8.5, mirroring admin/listicles + leadgen offers):
//   success → `{ ...entity }` / `{ items, paging }`; failure → `{ error,
//   fields? }` with 4xx. Handlers map Row→API on read and validate API→Row on
//   write via the pure Stage-A/B domain modules (leadgen/sections.ts +
//   leadgen/answers.ts). All SQL is .bind() parameterized over fixed-literal
//   table names; JSON columns parse defensively (D1 rule).
//
// The SAVE path (POST/PATCH) is the §12.1 derived-index rebuild: validate →
// resolve the answer-map Offers → block §12.4 archived/mismatched mappings →
// rebuildDerivedIndexes(content_json, answer_maps) → replace-set
// leadgen_section_available_offers + leadgen_section_answer_maps in ONE atomic
// batch, and re-render content_html through the Stage-A funnel presets. The
// derived indexes can never drift from content (idempotent rebuild-on-save,
// the listicles §5.4 discipline).

import { getFunnelDesign } from "../../public/leadgen/designs/registry";
import type { FunnelDesign } from "../../public/leadgen/designs/registry";
import {
  renderSectionComponents,
  renderSectionComponentsVisible,
  type LeadgenSectionRenderCtx,
} from "../../public/leadgen/components/presets";
// v2.5 Phase C (13 §13.4): the frame_context preview branch composes through
// the SAME serve-owned pieces as the live /lg frame path and the variant
// preview (resolveFrameComposition + renderQuoteFrame + the §13.1 legacy-shell
// fail-safe fork) — parity by construction, never a fork.
import { resolveFrameComposition } from "../../public/leadgen/serve";
import type { LeadgenFrameComposition } from "../../public/leadgen/serve";
import {
  LG_BANNERS_MOUNT_HTML,
  renderLegacyShell,
  renderQuoteFrame,
} from "../../public/leadgen/designs/frame";
import { resolveSiteBranding, type SiteBranding } from "../../leadgen/branding";
// §8.5 layout containers: question/mapping/ZIP walks consume the canonical
// flattened projection; ONLY the renderer receives the full tree (it recurses).
// v2.5 06 §6.6: named component presets validate against the SAME curated
// override-key set the content schema enforces (never a second list).
import {
  CURATED_DESIGN_OVERRIDE_KEYS,
  flattenComponents,
} from "../../public/leadgen/components/content-schema";
import { COMPONENT_CATALOG } from "../../public/leadgen/components/registry";
import type {
  LeadgenComponentNode,
  LeadgenSectionContent,
} from "../../public/leadgen/components/content-schema";
import { isPublicId, mintPublicId } from "../../leadgen/ids";
import {
  buildOfferPayload,
  type LeadgenAnswerMapping,
  type LeadgenRawAnswers,
  normalizeAnswers,
} from "../../leadgen/answers";
// Stage-A pure engines (P6) — CONSUMED here, never modified: the §12.3 IF/THEN
// dependency evaluator (admin preview + P7 runtime share it) and the §12.8
// server-side ZIP validator (`/^\d{5}$/`).
import { evaluateDependencies, type LeadgenDependencyState } from "../../leadgen/dependencies";
// §9.2 (E5) preview sims: typed `sim` parse + the pure post-render markup
// transform (preview-only — the shared preset renderer stays untouched, §9.1).
import { applyPreviewSimMarkup, parsePreviewSim } from "./preview-sim";
// §9.1 (Slice D2) events document: the Studio preview iframe runs the SAME
// generated runtime bundle the live shell's /lg/runtime/{version}.js serves
// (LEADGEN_RUNTIME_JS is exactly that route's body) with the SAME
// toPublicComponent config projection — parity by construction. The bundle is
// INLINED because the admin host has no tenant site context: every /lg/*
// path (including the bundle URL) rides publicSiteContextMiddleware and 404s
// on ADMIN_HOST, so a script-src from the studio srcdoc cannot load there.
import { parseSectionDesignOverrides, toPublicComponent } from "../../public/leadgen/config-dto";
import { LEADGEN_RUNTIME_JS } from "../../public/leadgen/runtime/engine-bundle.generated";
import { LEADGEN_TEMPLATE_VERSION } from "../../cache/cache-keys";
import { escapeHtml } from "../templates/layout";
import { validateZip } from "../../leadgen/maps";
import {
  mappingCompleteness,
  rebuildDerivedIndexes,
  sectionValidationStatus,
  validateMappingReferences,
  validateSection,
  type LeadgenAnswerMapEdge,
  type LeadgenSectionInput,
  type OfferSchemaInfo,
  type RebuildResult,
} from "../../leadgen/sections";
import type { FieldErrors } from "../../leadgen/validation";
import type { LeadgenPayloadNodeType, LeadgenTransformStep } from "../../leadgen/payload";
import { buildWhereClause, type FilterCondition } from "../query-filters";
import {
  buildPaging,
  deriveFieldLabel,
  escapeLike,
  idSelector,
  parseDateRange,
  parseJsonColumn,
  parsePaging,
  readJsonBody,
  type AdminContext,
} from "./offers-handlers";
import type {
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenSectionAnswerMapApi,
  LeadgenSectionAnswerMapRow,
  LeadgenSectionApi,
  LeadgenSectionAvailableOfferRow,
  LeadgenSectionRow,
  LeadgenSectionStatus,
} from "./db-types";

// ---------------------------------------------------------------------------
// small local helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// D1 100-binding safety: batch IN(?) reads in chunks of 80 (d1-database-safety).
function chunk<T>(items: readonly T[], size = 80): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const SECTION_STATUSES = ["active", "archived"] as const satisfies readonly LeadgenSectionStatus[];
const PAYLOAD_NODE_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "enum",
  "object",
  "array",
]);
const TRANSFORM_KINDS: ReadonlySet<string> = new Set([
  "mapBoolean",
  "mapEnum",
  "formatDate",
  "formatPhone",
  "toNumber",
  "toString",
  "trim",
]);

// ---------------------------------------------------------------------------
// Row → API mapping (03 §8.5)
// ---------------------------------------------------------------------------

export async function resolveSectionRow(
  db: D1Database,
  idParam: string,
): Promise<LeadgenSectionRow | null> {
  const selector = idSelector("section", idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM leadgen_sections WHERE id = ? LIMIT 1"
      : "SELECT * FROM leadgen_sections WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<LeadgenSectionRow>();
  return row ?? null;
}

export function sectionRowToApi(row: LeadgenSectionRow): LeadgenSectionApi {
  return {
    ...row,
    image_json: parseJsonColumn(row.image_json),
    content_json: parseJsonColumn(row.content_json),
    design_overrides_json: parseJsonColumn(row.design_overrides_json),
    address_validation_enabled: row.address_validation_enabled !== 0,
  };
}

function availableOfferRowToApi(row: LeadgenSectionAvailableOfferRow): Record<string, unknown> {
  return { ...row, selected: row.selected !== 0 };
}

// §8.5 Row-vs-API split: the API shape uses the §12.11 stable snake_case names
// (output_value_map / value_transform) with the JSON columns PARSED — never the
// DB `_json` column names. Emitting the `_json` names here caused the read shape
// to diverge from the write shape (parseAnswerMaps reads output_value_map /
// value_transform), so any read-modify-write silently wiped the per-Offer value
// map + transform. Read and write now share one key vocabulary end-to-end.
function answerMapRowToApi(row: LeadgenSectionAnswerMapRow): LeadgenSectionAnswerMapApi {
  const { output_value_map_json, transform_json, ...rest } = row;
  return {
    ...rest,
    output_value_map: parseObjectColumn(output_value_map_json),
    value_transform: parseTransformColumn(transform_json),
    required_for_offer: row.required_for_offer !== 0,
  };
}

// The parsed content components (defensive: a corrupt content_json yields []).
function parseComponents(contentJson: string): LeadgenSectionContent {
  const parsed = parseJsonColumn(contentJson);
  if (isRecord(parsed) && Array.isArray(parsed["components"])) {
    return { components: parsed["components"] as LeadgenSectionContent["components"] };
  }
  return { components: [] };
}

function countQuestions(content: LeadgenSectionContent): number {
  // A "question" is any component that carries an internal_field or is a
  // multi-field question (name/address) — i.e. it collects an answer. §8.5:
  // counted over the flattened projection so nested questions count too
  // (containers carry no internal_field and are excluded by construction).
  return flattenComponents(content.components).filter(
    (n) =>
      isRecord(n) &&
      (typeof (n as { internal_field?: unknown }).internal_field === "string" ||
        (n as { type?: unknown }).type === "NameFieldsGroup" ||
        (n as { type?: unknown }).type === "AddressAutocompleteQuestion"),
  ).length;
}

// ---------------------------------------------------------------------------
// Offer schema info loader (injected into the pure sections.ts checks)
// ---------------------------------------------------------------------------

interface OfferRefRow {
  id: number;
  public_id: string;
  status: string;
  activity: string;
  vertical: string;
  active_payload_schema_id: number | null;
}

// Extract (field path → node type) + required field paths from a parsed
// payload schema_json (the §11.5 flat-node shape). Defensive against corrupt
// stored JSON.
function schemaFieldInfo(schemaJson: string | null): {
  fieldTypes: Map<string, LeadgenPayloadNodeType>;
  requiredFieldPaths: string[];
} {
  const fieldTypes = new Map<string, LeadgenPayloadNodeType>();
  const requiredFieldPaths: string[] = [];
  const parsed = parseJsonColumn(schemaJson);
  if (isRecord(parsed) && isRecord(parsed["root"]) && Array.isArray(parsed["root"]["children"])) {
    for (const node of parsed["root"]["children"]) {
      if (!isRecord(node)) continue;
      const path = node["path"];
      const type = node["type"];
      if (typeof path !== "string" || typeof type !== "string" || !PAYLOAD_NODE_TYPES.has(type)) continue;
      fieldTypes.set(path, type as LeadgenPayloadNodeType);
      if (node["required"] === true) requiredFieldPaths.push(path);
    }
  }
  return { fieldTypes, requiredFieldPaths };
}

// Build the injected Map<offer_id, OfferSchemaInfo> for a set of numeric offer
// ids. Reads the offers + their ACTIVE payload schema_json. Chunked at 80 to
// respect the D1 100-binding limit.
async function loadOfferSchemas(
  db: D1Database,
  offerIds: readonly number[],
): Promise<Map<number, OfferSchemaInfo>> {
  const out = new Map<number, OfferSchemaInfo>();
  const unique = [...new Set(offerIds)];
  if (unique.length === 0) return out;

  const offers: OfferRefRow[] = [];
  for (const ids of chunk(unique)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, status, activity, vertical, active_payload_schema_id
         FROM leadgen_offers WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(...ids)
      .all<OfferRefRow>();
    for (const row of rows.results ?? []) offers.push(row);
  }

  // Load each referenced active schema's field info.
  const schemaIds = offers
    .map((o) => o.active_payload_schema_id)
    .filter((v): v is number => typeof v === "number");
  const schemaById = new Map<number, { public_id: string; schema_json: string | null }>();
  for (const ids of chunk(schemaIds)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, schema_json FROM leadgen_offer_payload_schemas WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
      )
      .bind(...ids)
      .all<{ id: number; public_id: string; schema_json: string | null }>();
    for (const row of rows.results ?? []) {
      schemaById.set(row.id, { public_id: row.public_id, schema_json: row.schema_json });
    }
  }

  for (const offer of offers) {
    const schema =
      offer.active_payload_schema_id !== null ? schemaById.get(offer.active_payload_schema_id) : undefined;
    const info = schema !== undefined ? schemaFieldInfo(schema.schema_json) : { fieldTypes: new Map(), requiredFieldPaths: [] };
    out.set(offer.id, {
      status: offer.status,
      activity: offer.activity,
      vertical: offer.vertical,
      active_schema_id: offer.active_payload_schema_id,
      active_schema_public_id: schema?.public_id ?? null,
      fieldTypes: info.fieldTypes,
      requiredFieldPaths: info.requiredFieldPaths,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Authored answer-map parsing (the editor's mapping-grid rows)
// ---------------------------------------------------------------------------

interface ParsedAnswerMaps {
  edges: LeadgenAnswerMapEdge[];
  selectedOfferIds: Set<number>;
  errors: FieldErrors;
}

function parseTransformSteps(raw: unknown, key: string, errors: FieldErrors): LeadgenTransformStep[] | null {
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) {
    errors[key] = "value_transform must be an array of steps";
    return null;
  }
  const steps: LeadgenTransformStep[] = [];
  for (const step of raw) {
    if (!isRecord(step) || typeof step["kind"] !== "string" || !TRANSFORM_KINDS.has(step["kind"])) {
      errors[key] = "value_transform contains an unknown step";
      return null;
    }
    if (step["kind"] === "mapEnum" && !isRecord(step["map"])) {
      errors[key] = "mapEnum step requires a map object";
      return null;
    }
    if (step["kind"] === "formatDate" && (typeof step["format"] !== "string" || step["format"].trim() === "")) {
      errors[key] = "formatDate step requires a format string";
      return null;
    }
    steps.push(step as unknown as LeadgenTransformStep);
  }
  return steps;
}

// Parse the body's `answer_maps[]` (+ optional `selected_offers[]`), resolving
// each edge's offer reference (numeric id OR lgo_ public id) to the numeric id.
// Content-node defaults fill an omitted question_key / internal_field /
// answer_type. Structural errors are field-keyed by edge index.
async function parseAnswerMaps(
  db: D1Database,
  body: Record<string, unknown>,
  content: LeadgenSectionContent,
): Promise<ParsedAnswerMaps> {
  const errors: FieldErrors = {};
  const rawMaps = body["answer_maps"];
  const nodesByQuestionId = new Map<string, Record<string, unknown>>();
  // §8.5: mappable questions come from the flattened projection — an edge may
  // bind to a question nested inside a layout container; container nodes
  // themselves are not mappable (they never appear in the flattened list).
  for (const node of flattenComponents(content.components)) {
    if (isRecord(node) && typeof node["question_id"] === "string") {
      nodesByQuestionId.set(node["question_id"], node);
    }
  }

  // Resolve every referenced offer (numeric or public) to a numeric id.
  const publicRefs = new Set<string>();
  const numericRefs = new Set<number>();
  const rawList = Array.isArray(rawMaps) ? rawMaps : [];
  for (const item of rawList) {
    if (!isRecord(item)) continue;
    const ref = item["offer_id"] ?? item["offer_public_id"];
    if (typeof ref === "number" && Number.isInteger(ref)) numericRefs.add(ref);
    else if (typeof ref === "string" && isPublicId("offer", ref)) publicRefs.add(ref);
  }
  const offerIdByPublicId = new Map<string, number>();
  for (const ids of chunk([...publicRefs])) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id FROM leadgen_offers WHERE public_id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(...ids)
      .all<{ id: number; public_id: string }>();
    for (const row of rows.results ?? []) offerIdByPublicId.set(row.public_id, row.id);
  }

  const edges: LeadgenAnswerMapEdge[] = [];
  if (rawMaps !== undefined && !Array.isArray(rawMaps)) {
    errors["answer_maps"] = "answer_maps must be an array";
  }
  rawList.forEach((item, index) => {
    const base = `answer_maps[${index}]`;
    if (!isRecord(item)) {
      errors[base] = "answer_map must be an object";
      return;
    }
    const questionId = trimmedString(item["question_id"]);
    if (questionId === null) {
      errors[`${base}.question_id`] = "question_id is required";
      return;
    }
    const node = nodesByQuestionId.get(questionId);
    if (node === undefined) {
      errors[`${base}.question_id`] = `question_id '${questionId}' is not a component in content_json`;
      return;
    }

    // offer reference → numeric id.
    let offerId: number | null = null;
    const ref = item["offer_id"] ?? item["offer_public_id"];
    if (typeof ref === "number" && Number.isInteger(ref)) offerId = ref;
    else if (typeof ref === "string" && isPublicId("offer", ref)) offerId = offerIdByPublicId.get(ref) ?? null;
    if (offerId === null) {
      errors[`${base}.offer_id`] = "offer_id must be a numeric id or an lgo_ public id for an existing Offer";
      return;
    }

    const fieldPath = trimmedString(item["offer_payload_field_path"]);
    if (fieldPath === null) {
      errors[`${base}.offer_payload_field_path`] = "offer_payload_field_path is required";
      return;
    }
    const providerType = trimmedString(item["provider_expected_type"]);
    if (providerType === null || !PAYLOAD_NODE_TYPES.has(providerType)) {
      errors[`${base}.provider_expected_type`] =
        "provider_expected_type must be one of string|number|boolean|enum|object|array";
      return;
    }

    // Primary key names are the §12.11 API names (output_value_map /
    // value_transform); the DB `_json` column names are accepted defensively as
    // aliases so a legacy client resending the raw column shape still round-trips
    // (B1 read/write key-consistency safety net).
    const rawOutputValueMap = item["output_value_map"] ?? item["output_value_map_json"];
    let outputValueMap: Record<string, unknown> | null = null;
    if (rawOutputValueMap !== undefined && rawOutputValueMap !== null) {
      if (!isRecord(rawOutputValueMap)) {
        errors[`${base}.output_value_map`] = "output_value_map must be an object";
        return;
      }
      outputValueMap = rawOutputValueMap;
    }
    const transform = parseTransformSteps(
      item["value_transform"] ?? item["transform_json"],
      `${base}.value_transform`,
      errors,
    );
    if (errors[`${base}.value_transform`] !== undefined) return;

    // Defaults from the content node fill omitted fields.
    const questionKey =
      trimmedString(item["question_key"]) ??
      (typeof node["question_key"] === "string" ? node["question_key"] : questionId);
    const internalField =
      trimmedString(item["internal_field"]) ??
      (typeof node["internal_field"] === "string" ? node["internal_field"] : "");
    const answerType =
      trimmedString(item["answer_type"]) ??
      (typeof node["answer_type"] === "string" ? node["answer_type"] : "string");

    edges.push({
      question_id: questionId,
      question_key: questionKey,
      internal_field: internalField,
      answer_type: answerType,
      offer_id: offerId,
      offer_payload_field_path: fieldPath,
      provider_expected_type: providerType,
      output_value_map: outputValueMap,
      value_transform: transform,
      required_for_offer: item["required_for_offer"] === true,
      default_value: typeof item["default_value"] === "string" ? item["default_value"] : null,
      fallback_value: typeof item["fallback_value"] === "string" ? item["fallback_value"] : null,
    });
  });

  // Optional explicit selection set (offers picked but perhaps not yet mapped).
  const selectedOfferIds = new Set<number>();
  const rawSelected = body["selected_offers"];
  if (Array.isArray(rawSelected)) {
    for (const item of rawSelected) {
      if (typeof item === "number" && Number.isInteger(item)) selectedOfferIds.add(item);
      else if (typeof item === "string" && isPublicId("offer", item)) {
        const resolved = offerIdByPublicId.get(item);
        if (resolved !== undefined) selectedOfferIds.add(resolved);
      }
    }
  }
  // Every mapped offer is implicitly selected.
  for (const edge of edges) selectedOfferIds.add(edge.offer_id);

  return { edges, selectedOfferIds, errors };
}

// ---------------------------------------------------------------------------
// content_html render (Stage-A funnel presets)
// ---------------------------------------------------------------------------

// v2.5 03 §3.4: the persisted content_html renders through the SAME
// sectionCtx contract as serve/preview — a BOUND QuestionHeadline/Subheadline
// node persists the Section's canonical column text (so a headline_text edit
// re-renders content_html with the new text on save), continue_mode threads
// the §11.5 ownership, and design_overrides_json applies as layer 4. No frame
// context in Phase A (content_html is funnel-agnostic; placement is a
// composition-time concern). Legacy content (no bound nodes, no overrides)
// renders byte-identically.
function renderContentHtml(value: LeadgenSectionInput): string {
  const ctx: LeadgenSectionRenderCtx = {
    headline_text: value.headline_text,
    subheadline_text: value.subheadline_text,
    continue_mode: value.continue_mode,
    design_overrides: parseSectionDesignOverrides(value.design_overrides_json),
  };
  return renderSectionComponents(value.content.components, getFunnelDesign(null), ctx);
}

// ---------------------------------------------------------------------------
// Derived-index write statements (the §12.1 replace-set)
// ---------------------------------------------------------------------------

type SectionIdRef = { id: number } | { publicId: string };

function availableOfferInsert(
  db: D1Database,
  ref: SectionIdRef,
  row: RebuildResult["availableOffers"][number],
): D1PreparedStatement {
  const cols = "(section_id, offer_id, selected, mapping_state, required_fields_total, required_fields_mapped)";
  if ("id" in ref) {
    return db
      .prepare(`INSERT INTO leadgen_section_available_offers ${cols} VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(ref.id, row.offer_id, row.selected ? 1 : 0, row.mapping_state, row.required_fields_total, row.required_fields_mapped);
  }
  return db
    .prepare(
      `INSERT INTO leadgen_section_available_offers ${cols} VALUES ((SELECT id FROM leadgen_sections WHERE public_id = ?), ?, ?, ?, ?, ?)`,
    )
    .bind(ref.publicId, row.offer_id, row.selected ? 1 : 0, row.mapping_state, row.required_fields_total, row.required_fields_mapped);
}

function answerMapInsert(
  db: D1Database,
  ref: SectionIdRef,
  row: RebuildResult["answerMaps"][number],
): D1PreparedStatement {
  const cols =
    "(public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id, payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type, output_value_map_json, transform_json, required_for_offer, default_value, fallback_value, mapping_status, validation_status)";
  const tail = [
    mintPublicId("answer_field_map"),
    // section_id placeholder handled below
    row.question_id,
    row.question_key,
    row.internal_field,
    row.answer_type,
    row.offer_id,
    row.payload_schema_id,
    row.payload_schema_public_id,
    row.offer_payload_field_path,
    row.provider_expected_type,
    row.output_value_map === null ? null : JSON.stringify(row.output_value_map),
    row.value_transform === null ? null : JSON.stringify(row.value_transform),
    row.required_for_offer ? 1 : 0,
    row.default_value,
    row.fallback_value,
    row.mapping_status,
    row.validation_status,
  ];
  if ("id" in ref) {
    return db
      .prepare(
        `INSERT INTO leadgen_section_answer_maps ${cols} VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(tail[0], ref.id, ...tail.slice(1));
  }
  return db
    .prepare(
      `INSERT INTO leadgen_section_answer_maps ${cols} VALUES (?, (SELECT id FROM leadgen_sections WHERE public_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(tail[0], ref.publicId, ...tail.slice(1));
}

// The full replace-set for the derived indexes: delete both, reinsert all.
// Every INSERT is a single-row statement (≤18 bindings) — well under the D1
// 100-binding-per-statement limit, so no chunking of a multi-row VALUES list
// is needed. Only persist edges whose Offer pinned an active schema
// (payload_schema_id is a NOT NULL FK; validateMappingReferences guarantees it).
function derivedStatements(
  db: D1Database,
  ref: SectionIdRef,
  rebuild: RebuildResult,
  sectionId: number | null,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  if (sectionId !== null) {
    statements.push(
      db.prepare("DELETE FROM leadgen_section_available_offers WHERE section_id = ?").bind(sectionId),
      db.prepare("DELETE FROM leadgen_section_answer_maps WHERE section_id = ?").bind(sectionId),
    );
  }
  for (const offer of rebuild.availableOffers) {
    statements.push(availableOfferInsert(db, ref, offer));
  }
  for (const map of rebuild.answerMaps) {
    if (map.payload_schema_id === null || map.payload_schema_public_id === null) continue;
    statements.push(answerMapInsert(db, ref, map));
  }
  return statements;
}

// ---------------------------------------------------------------------------
// GET /sections — list + §9.3 filters + derived counts + pager
// ---------------------------------------------------------------------------

type SectionListRow = LeadgenSectionRow & {
  mapped_offer_count: number;
  invalid_offer_count: number;
  incomplete_offer_count: number;
};

// The overall completeness badge (§9.3 "mapping-completeness badge"): worst
// state across the Section's mapped Offers.
function overallCompleteness(row: SectionListRow): "complete" | "incomplete" | "invalid" | "none" {
  if (row.mapped_offer_count === 0) return "none";
  if (row.invalid_offer_count > 0) return "invalid";
  if (row.incomplete_offer_count > 0) return "incomplete";
  return "complete";
}

export async function listSectionsHandler(c: AdminContext): Promise<Response> {
  const search = c.req.query("search")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const vertical = c.req.query("vertical")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";

  if (status !== "" && !(SECTION_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      { error: "Validation failed", fields: { status: `status must be one of ${SECTION_STATUSES.join("|")}` } },
      400,
    );
  }

  const like = `%${escapeLike(search)}%`;
  const filters: FilterCondition[] = [
    {
      when: search !== "",
      clause: "(section_name LIKE ? ESCAPE '\\' OR headline_text LIKE ? ESCAPE '\\')",
      params: [like, like],
    },
    { when: activity !== "", clause: "activity = ?", params: [activity] },
    { when: vertical !== "", clause: "vertical = ?", params: [vertical] },
    { when: status !== "", clause: "status = ?", params: [status] },
  ];
  const { clause, params } = buildWhereClause(filters);
  const { page, pageSize, offset } = parsePaging(c);

  const rows = await c.env.DB.prepare(
    `SELECT s.*,
        (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id) AS mapped_offer_count,
        (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state = 'invalid') AS invalid_offer_count,
        (SELECT COUNT(*) FROM leadgen_section_available_offers sao WHERE sao.section_id = s.id AND sao.mapping_state IN ('incomplete','selected')) AS incomplete_offer_count
     FROM leadgen_sections s WHERE ${clause}
     ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<SectionListRow>();
  const totalRow = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM leadgen_sections WHERE ${clause}`)
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);

  return c.json({
    items: (rows.results ?? []).map((row) => {
      const content = parseComponents(row.content_json);
      return {
        ...sectionRowToApi(row),
        question_count: countQuestions(content),
        mapped_offer_count: Number(row.mapped_offer_count ?? 0),
        completeness: overallCompleteness(row),
      };
    }),
    paging: buildPaging(page, pageSize, total),
  });
}

// ---------------------------------------------------------------------------
// The shared SAVE core (create + patch)
// ---------------------------------------------------------------------------

interface SaveOutcome {
  errors: FieldErrors | null;
  rebuild: RebuildResult | null;
  value: ReturnType<typeof validateSection>["value"];
  contentHtml: string;
  // FIX 5 (03 §3.6): the content validator's non-blocking warnings as
  // Problem rows — threaded into the POST/PATCH SUCCESS response so a save
  // never silently swallows a frame_scope_component / duplicate_continue.
  problems: ReturnType<typeof validateSection>["problems"];
}

// Validate scalars + content, parse + resolve answer maps, block §12.4
// archived/mismatched mappings, and rebuild the derived indexes. Pure of any
// write — the caller commits the batch.
async function prepareSave(c: AdminContext, body: Record<string, unknown>): Promise<SaveOutcome> {
  const { errors, value, problems } = validateSection(body);
  if (value === null) return { errors, rebuild: null, value: null, contentHtml: "", problems: [] };

  const parsed = await parseAnswerMaps(c.env.DB, body, value.content);
  const mergedErrors: FieldErrors = { ...parsed.errors };
  if (Object.keys(mergedErrors).length > 0) {
    return { errors: mergedErrors, rebuild: null, value: null, contentHtml: "", problems: [] };
  }

  const offerSchemas = await loadOfferSchemas(
    c.env.DB,
    [...parsed.selectedOfferIds, ...parsed.edges.map((e) => e.offer_id)],
  );

  // §12.4: block mapping into an archived / mismatched / schema-less Offer.
  const refErrors = validateMappingReferences(
    { activity: value.activity, vertical: value.vertical },
    parsed.edges,
    offerSchemas,
  );
  // Also block SELECTING an offer that mismatches the Section activity/vertical
  // or is archived (a selected-but-unmapped offer still surfaces in the index).
  for (const offerId of parsed.selectedOfferIds) {
    const info = offerSchemas.get(offerId);
    if (info === undefined) {
      refErrors[`selected_offers.${offerId}`] = `unknown offer id ${offerId}`;
    } else if (info.status !== "active") {
      refErrors[`selected_offers.${offerId}`] = `offer is ${info.status} — only active Offers can be selected (§12.4)`;
    } else if (info.activity !== value.activity || info.vertical !== value.vertical) {
      refErrors[`selected_offers.${offerId}`] = "offer activity/vertical does not match the Section (§12.4)";
    }
  }
  if (Object.keys(refErrors).length > 0) {
    return { errors: refErrors, rebuild: null, value: null, contentHtml: "", problems: [] };
  }

  const rebuild = rebuildDerivedIndexes({
    content: value.content,
    answerMaps: parsed.edges,
    offerSchemas,
    selectedOfferIds: parsed.selectedOfferIds,
  });
  return { errors: null, rebuild, value, contentHtml: renderContentHtml(value), problems };
}

// ---------------------------------------------------------------------------
// POST /sections — create (§12.1)
// ---------------------------------------------------------------------------

export async function createSectionHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const prepared = await prepareSave(c, body);
  if (prepared.value === null || prepared.rebuild === null) {
    return c.json({ error: "Validation failed", fields: prepared.errors ?? {} }, 400);
  }
  const value = prepared.value;

  const publicId = mintPublicId("section");
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO leadgen_sections
         (public_id, section_name, activity, vertical, headline_text, subheadline_text, image_json,
          content_json, content_html, continue_mode, design_overrides_json, address_validation_enabled, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      publicId,
      value.section_name,
      value.activity,
      value.vertical,
      value.headline_text,
      value.subheadline_text,
      value.image_json,
      value.content_json,
      prepared.contentHtml,
      value.continue_mode,
      value.design_overrides_json,
      value.address_validation_enabled ? 1 : 0,
      value.status,
      null,
    ),
    ...derivedStatements(c.env.DB, { publicId }, prepared.rebuild, null),
  ];
  await c.env.DB.batch(statements);

  const row = await c.env.DB.prepare("SELECT * FROM leadgen_sections WHERE public_id = ? LIMIT 1")
    .bind(publicId)
    .first<LeadgenSectionRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  // FIX 5 (03 §3.6): the success response carries the save's non-blocking
  // validation problems (frame_scope_component / duplicate_continue) so the
  // editor can surface them inline — the save itself is unaffected.
  return c.json({ ...(await sectionDetailJson(c.env.DB, row)), problems: prepared.problems }, 201);
}

// ---------------------------------------------------------------------------
// GET /sections/:id — detail (+ available offers, answer maps, validation)
// ---------------------------------------------------------------------------

async function readAvailableOffers(db: D1Database, sectionId: number): Promise<LeadgenSectionAvailableOfferRow[]> {
  const rows = await db
    .prepare("SELECT * FROM leadgen_section_available_offers WHERE section_id = ? ORDER BY offer_id ASC")
    .bind(sectionId)
    .all<LeadgenSectionAvailableOfferRow>();
  return rows.results ?? [];
}

async function readAnswerMaps(db: D1Database, sectionId: number): Promise<LeadgenSectionAnswerMapRow[]> {
  const rows = await db
    .prepare("SELECT * FROM leadgen_section_answer_maps WHERE section_id = ? ORDER BY id ASC")
    .bind(sectionId)
    .all<LeadgenSectionAnswerMapRow>();
  return rows.results ?? [];
}

// v2.5 07 §7.3 / 12 §12.2 (DEV-55 C1 data leg): the per-Offer provider-value
// PROJECTION the Choices tab's read-only "Provider values: k/n Offers" chip
// consumes. One row per SELECTED offer — offer identity (name + public id for
// the deep link) + this Section's mapping edges for that offer keyed by
// internal_field with the edge's parsed output_value_map. Derived ENTIRELY
// from the existing mapping model (leadgen_section_answer_maps +
// leadgen_section_available_offers) — no new storage; additive response key.
async function offerValueProjection(
  db: D1Database,
  availableOffers: readonly LeadgenSectionAvailableOfferRow[],
  answerMaps: readonly LeadgenSectionAnswerMapRow[],
): Promise<Array<Record<string, unknown>>> {
  const selectedIds = availableOffers.filter((o) => o.selected !== 0).map((o) => o.offer_id);
  if (selectedIds.length === 0) return [];
  const names = new Map<number, { public_id: string; offer_name: string }>();
  for (const ids of chunk(selectedIds)) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, offer_name FROM leadgen_offers WHERE id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(...ids)
      .all<{ id: number; public_id: string; offer_name: string }>();
    for (const row of rows.results ?? []) names.set(row.id, { public_id: row.public_id, offer_name: row.offer_name });
  }
  return selectedIds.map((offerId) => {
    const identity = names.get(offerId);
    const fields: Record<string, unknown> = {};
    for (const edge of answerMaps) {
      if (edge.offer_id !== offerId || edge.internal_field === "") continue;
      fields[edge.internal_field] = {
        path: edge.offer_payload_field_path,
        values: parseObjectColumn(edge.output_value_map_json),
      };
    }
    return {
      offer_id: offerId,
      offer_public_id: identity?.public_id ?? null,
      offer_name: identity?.offer_name ?? String(offerId),
      fields,
    };
  });
}

async function sectionDetailJson(db: D1Database, row: LeadgenSectionRow): Promise<Record<string, unknown>> {
  const availableOffers = await readAvailableOffers(db, row.id);
  const answerMaps = await readAnswerMaps(db, row.id);
  return {
    ...sectionRowToApi(row),
    available_offers: availableOffers.map(availableOfferRowToApi),
    answer_maps: answerMaps.map(answerMapRowToApi),
    // DEV-55 (12 §12.2): the studio SSR blob's chip data source.
    offer_values: await offerValueProjection(db, availableOffers, answerMaps),
  };
}

export async function getSectionHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  return c.json(await sectionDetailJson(c.env.DB, row));
}

// ---------------------------------------------------------------------------
// PATCH /sections/:id — merge-then-revalidate + derived rebuild (§12.1)
// ---------------------------------------------------------------------------

const SECTION_PATCH_FIELDS = [
  "section_name",
  "activity",
  "vertical",
  "headline_text",
  "subheadline_text",
  "image_json",
  "image",
  "content_json",
  "content",
  "continue_mode",
  "design_overrides_json",
  "design_overrides",
  "address_validation_enabled",
  "status",
  "answer_maps",
  "selected_offers",
] as const;

export async function patchSectionHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
  const provided = SECTION_PATCH_FIELDS.filter((f) => body[f] !== undefined);
  if (provided.length === 0) return c.json({ error: "No updatable fields provided" }, 400);

  // Merge the provided fields over the stored state, then re-validate the whole
  // (a partial update can never leave the Section invalid). The full Section is
  // always re-validated + the derived indexes always rebuilt from the merged
  // content (idempotent — §12.1).
  const merged: Record<string, unknown> = {
    section_name: existing.section_name,
    activity: existing.activity,
    vertical: existing.vertical,
    headline_text: existing.headline_text,
    subheadline_text: existing.subheadline_text,
    image_json: existing.image_json,
    content_json: existing.content_json,
    continue_mode: existing.continue_mode,
    design_overrides_json: existing.design_overrides_json,
    address_validation_enabled: existing.address_validation_enabled,
    status: existing.status,
    // answer_maps default to the stored derived rows re-expressed as authored
    // edges, so a scalar-only PATCH preserves the mapping graph.
    answer_maps: await storedAnswerMapsAsInput(c.env.DB, existing.id),
  };
  for (const field of provided) {
    if (field === "image") merged["image_json"] = body["image"];
    else if (field === "design_overrides") merged["design_overrides_json"] = body["design_overrides"];
    else if (field === "content") merged["content_json"] = body["content"];
    else merged[field] = body[field];
  }
  if (body["image_json"] === null || body["image"] === null) merged["image_json"] = null;
  if (body["design_overrides_json"] === null || body["design_overrides"] === null) merged["design_overrides_json"] = null;
  if (body["subheadline_text"] === null) merged["subheadline_text"] = null;

  const prepared = await prepareSave(c, merged);
  if (prepared.value === null || prepared.rebuild === null) {
    return c.json({ error: "Validation failed", fields: prepared.errors ?? {} }, 400);
  }
  const value = prepared.value;

  const contentChanged = value.content_json !== existing.content_json;
  const mappingProvided = body["answer_maps"] !== undefined || body["selected_offers"] !== undefined;
  const contentVersion = existing.content_version + (contentChanged ? 1 : 0);
  const mappingVersion = existing.section_mapping_version + (mappingProvided || contentChanged ? 1 : 0);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE leadgen_sections
         SET section_name = ?, activity = ?, vertical = ?, headline_text = ?, subheadline_text = ?,
             image_json = ?, content_json = ?, content_html = ?, continue_mode = ?,
             design_overrides_json = ?, address_validation_enabled = ?, status = ?,
             content_version = ?, section_mapping_version = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(
      value.section_name,
      value.activity,
      value.vertical,
      value.headline_text,
      value.subheadline_text,
      value.image_json,
      value.content_json,
      prepared.contentHtml,
      value.continue_mode,
      value.design_overrides_json,
      value.address_validation_enabled ? 1 : 0,
      value.status,
      contentVersion,
      mappingVersion,
      existing.id,
    ),
    ...derivedStatements(c.env.DB, { id: existing.id }, prepared.rebuild, existing.id),
  ];
  await c.env.DB.batch(statements);

  const updated = await c.env.DB.prepare("SELECT * FROM leadgen_sections WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<LeadgenSectionRow>();
  if (!updated) return c.json({ error: "Update failed" }, 500);
  // FIX 5 (03 §3.6): non-blocking validation problems ride the PATCH success
  // response (same shape as the POST leg — the island surfaces them inline).
  return c.json({ ...(await sectionDetailJson(c.env.DB, updated)), problems: prepared.problems });
}

// The stored derived answer-map rows re-expressed as authored edge inputs, so a
// scalar-only PATCH round-trips the mapping graph unchanged.
async function storedAnswerMapsAsInput(db: D1Database, sectionId: number): Promise<Record<string, unknown>[]> {
  const rows = await readAnswerMaps(db, sectionId);
  return rows.map((row) => ({
    question_id: row.question_id,
    question_key: row.question_key,
    internal_field: row.internal_field,
    answer_type: row.answer_type,
    offer_id: row.offer_id,
    offer_payload_field_path: row.offer_payload_field_path,
    provider_expected_type: row.provider_expected_type,
    output_value_map: parseJsonColumn(row.output_value_map_json),
    value_transform: parseJsonColumn(row.transform_json),
    required_for_offer: row.required_for_offer !== 0,
    default_value: row.default_value,
    fallback_value: row.fallback_value,
  }));
}

// ---------------------------------------------------------------------------
// DELETE /sections/:id — archive (03 §9.6: status flip, never a hard delete)
// ---------------------------------------------------------------------------

export async function deleteSectionHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  await c.env.DB.prepare(
    "UPDATE leadgen_sections SET status = 'archived', updated_at = unixepoch() WHERE id = ?",
  )
    .bind(row.id)
    .run();
  return c.json({ ok: true, id: row.id, public_id: row.public_id, status: "archived" });
}

// ---------------------------------------------------------------------------
// POST /sections/preview — server-render desktop + mobile from draft content
// ---------------------------------------------------------------------------

// §14.9: render a (possibly mid-edit) Section from a DRAFT content_json — no
// persist. Structural parse only (malformed JSON — or a malformed §9.2
// parameter — is the only rejection; a mapping-less draft still previews).
// Returns BOTH viewports' HTML + the scoped chrome CSS; the editor's preview
// iframe injects the CSS.
//
// §9.2 (E5) parameterization — ADDITIVE body params over the legacy shape:
//   design_id?  → getFunnelDesign(design_id) (absent/unknown → default,
//                 §14.1); the wrapper's data-funnel-design + the chrome-CSS
//                 scope carry the RESOLVED id (the :962 hardcode is gone).
//   viewport?   → "desktop"|"mobile"; when present the response ALSO carries
//                 preview.html = that viewport's markup.
//   sim?        → { state?, answers?, auto_advance?, flow? } — every sim is
//                 SERVER-rendered into the markup (preview-sim.ts), never a
//                 cosmetic attribute for the client to interpret.
// A legacy body (none of the new params) produces byte-identical
// preview.{css,desktop,mobile,component_count} — regression-pinned.
//
// v2.5 Phase C (13 §13.4, ADDITIVE): `frame_context?: {funnel_public_id,
// variant_public_id?, site_id?}` — when present the CURRENT unit renders
// INSIDE that funnel's effective frame via the SAME renderQuoteFrame the
// runtime shell embeds (05 §5.3 mode 5); absent → the unit-only path above,
// byte-identical (pinned in leadgen-section-preview-frame.test.ts). The
// existing design_id/viewport/sim params stay honored in-frame. Unknown
// funnel/variant/site → 404; a NULL/invalid stored frame composes through the
// byte-pinned legacy shell — the same §13.1 fail-safe fork serve.ts and the
// variant preview take.

// The resolved §13.4 frame context for one preview render. Identity fields
// are ID-LEVEL (not rows) so the §5.3 mode-5 DEFAULT-frame leg — no funnel at
// all — composes with the established honest lg?_preview placeholders.
interface SectionPreviewFrame {
  funnelPublicId: string;
  variantPublicId: string | null;
  variantContentVersion: number | null;
  quotePublicId: string;
  branding: SiteBranding | null;
  // null = NULL/invalid stored frame → the legacy-shell fork.
  composition: LeadgenFrameComposition | null;
  // The BASE (layer-1) design the composition resolved over.
  design: FunnelDesign;
  // Progress/footer total: the variant's ordered-section count (§11.1), 1 when
  // no variant participates (the unit previews as a single slide).
  sectionCount: number;
}

type SectionPreviewFrameResult =
  | { kind: "ok"; frame: SectionPreviewFrame }
  | { kind: "invalid"; fields: FieldErrors }
  | { kind: "not_found" };

// Parse + resolve the §13.4 frame_context body param. `explicitDesignId` is
// the request's own design_id (when sent it stays the layer-1 base in-frame —
// "existing design_id honored"); otherwise the funnel's variant design drives
// the composition exactly like the variant preview (getFunnelDesign registry
// rule for the variant-less call).
async function resolveSectionPreviewFrame(
  db: D1Database,
  raw: unknown,
  explicitDesignId: string | null,
): Promise<SectionPreviewFrameResult> {
  if (!isRecord(raw)) {
    return {
      kind: "invalid",
      fields: { frame_context: "frame_context must be a JSON object" },
    };
  }
  // §5.3 mode-5 empty state (ADDITIVE): `frame_context: { default: true }` —
  // no funnel exists (the Section is used by zero Quotes), so the unit
  // composes inside the DEFAULT template frame (effectiveFrame("centered")
  // via the same resolveFrameComposition path), template defaults only: no
  // theme, no variant overrides, no site branding. Identity fields are the
  // honest lg?_preview placeholders (the events-doc idiom — never faked live
  // ids).
  if (raw["default"] === true && raw["funnel_public_id"] === undefined) {
    const defaultDesign = getFunnelDesign(explicitDesignId);
    const composition = resolveFrameComposition(
      {
        frame_config_json: JSON.stringify({ version: 1, template: "centered" }),
        theme_json: null,
        frame_overrides_json: null,
      },
      defaultDesign,
    );
    return {
      kind: "ok",
      frame: {
        funnelPublicId: "lgf_preview",
        variantPublicId: null,
        variantContentVersion: null,
        quotePublicId: "lgq_preview",
        branding: null,
        composition,
        design: defaultDesign,
        sectionCount: 1,
      },
    };
  }
  const fields: FieldErrors = {};
  const funnelPublicId = trimmedString(raw["funnel_public_id"]);
  if (funnelPublicId === null) {
    fields["frame_context.funnel_public_id"] = "frame_context.funnel_public_id is required";
  }
  let variantPublicId: string | null = null;
  if (raw["variant_public_id"] !== undefined && raw["variant_public_id"] !== null) {
    variantPublicId = trimmedString(raw["variant_public_id"]);
    if (variantPublicId === null) {
      fields["frame_context.variant_public_id"] =
        "frame_context.variant_public_id must be a variant public id string";
    }
  }
  let siteId: string | null = null;
  if (raw["site_id"] !== undefined && raw["site_id"] !== null) {
    siteId = trimmedString(raw["site_id"]);
    if (siteId === null) {
      fields["frame_context.site_id"] = "frame_context.site_id must be a site id string";
    }
  }
  if (Object.keys(fields).length > 0) return { kind: "invalid", fields };

  // Unknown funnel → 404 (§13.4).
  const funnel = await db
    .prepare("SELECT * FROM leadgen_funnels WHERE public_id = ? LIMIT 1")
    .bind(funnelPublicId)
    .first<LeadgenFunnelRow>();
  if (funnel === null) return { kind: "not_found" };

  // Optional variant — must belong to THIS funnel (layer-3 overrides + the
  // §11.1 progress total ride the variant).
  let variant: LeadgenFunnelVariantRow | null = null;
  let sectionCount = 1;
  if (variantPublicId !== null) {
    variant = await db
      .prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ? AND funnel_id = ? LIMIT 1")
      .bind(variantPublicId, funnel.id)
      .first<LeadgenFunnelVariantRow>();
    if (variant === null) return { kind: "not_found" };
    const counted = await db
      .prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variant_sections WHERE variant_id = ?")
      .bind(variant.id)
      .first<{ n: number }>();
    sectionCount = Math.max(1, Number(counted?.n ?? 0));
  }

  // The owning quote's public id (root identity attr — the funnel always has
  // one; a broken FK degrades to Not Found rather than a corrupt render).
  const quote = await db
    .prepare("SELECT public_id FROM leadgen_quotes WHERE id = ? LIMIT 1")
    .bind(funnel.quote_id)
    .first<{ public_id: string }>();
  if (quote === null) return { kind: "not_found" };

  // site_id (C4): ANY CMS site is legal — branding preview needs no
  // activation and creates none. Unknown site → 404 (the variant-preview rule).
  let branding: SiteBranding | null = null;
  if (siteId !== null) {
    const site = await db
      .prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
      .bind(siteId)
      .first<{ id: string }>();
    if (site === null) return { kind: "not_found" };
    branding = await resolveSiteBranding(db, siteId);
  }

  // Layer-1 base: the request's explicit design_id when sent (honored
  // in-frame), else the variant's stored design, else the registry default.
  const design = getFunnelDesign(explicitDesignId ?? variant?.funnel_design_id ?? null);
  const composition = resolveFrameComposition(
    {
      frame_config_json: funnel.frame_config_json,
      theme_json: funnel.theme_json,
      frame_overrides_json: variant?.frame_overrides_json ?? null,
    },
    design,
  );
  return {
    kind: "ok",
    frame: {
      funnelPublicId: funnel.public_id,
      variantPublicId: variant?.public_id ?? null,
      variantContentVersion: variant?.content_version ?? null,
      quotePublicId: quote.public_id,
      branding,
      composition,
      design,
      sectionCount,
    },
  };
}
export async function previewSectionHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const rawContent = body["content_json"] ?? body["content"];
  let content: LeadgenSectionContent = { components: [] };
  if (typeof rawContent === "string") {
    if (rawContent.trim() === "") {
      return c.json({ error: "Validation failed", fields: { content_json: "content_json is required" } }, 400);
    }
    try {
      const parsed = JSON.parse(rawContent) as unknown;
      content = isRecord(parsed) && Array.isArray(parsed["components"])
        ? { components: parsed["components"] as LeadgenSectionContent["components"] }
        : { components: [] };
    } catch {
      return c.json({ error: "Validation failed", fields: { content_json: "content_json must be valid JSON" } }, 400);
    }
  } else if (isRecord(rawContent) && Array.isArray(rawContent["components"])) {
    content = { components: rawContent["components"] as LeadgenSectionContent["components"] };
  } else {
    return c.json({ error: "Validation failed", fields: { content_json: "content_json is required" } }, 400);
  }

  // --- §9.2 parameter parse (design_id / viewport / sim) --------------------
  const rawDesignId = body["design_id"];
  if (rawDesignId !== undefined && rawDesignId !== null && typeof rawDesignId !== "string") {
    return c.json(
      { error: "Validation failed", fields: { design_id: "design_id must be a string" } },
      400,
    );
  }
  // Absent/unknown → the default design (§14.1 registry rule). The RESOLVED
  // design drives the wrapper attribute, the CSS scope, and the echo below —
  // this replaces the previous getFunnelDesign(null) hardcode.
  const design = getFunnelDesign(typeof rawDesignId === "string" ? rawDesignId : null);

  const rawViewport = body["viewport"];
  if (rawViewport !== undefined && rawViewport !== null && rawViewport !== "desktop" && rawViewport !== "mobile") {
    return c.json(
      { error: "Validation failed", fields: { viewport: 'viewport must be "desktop" or "mobile"' } },
      400,
    );
  }
  const viewport = rawViewport === "desktop" || rawViewport === "mobile" ? rawViewport : undefined;

  const simParse = parsePreviewSim(body["sim"]);
  if (simParse.error !== null) {
    return c.json({ error: "Validation failed", fields: simParse.error }, 400);
  }
  const sim = simParse.sim;

  // --- v2.5 03 §3.4 sectionCtx (ADDITIVE body params) ------------------------
  // The draft's Section-row fields, when the caller sends them: canonical
  // headline/subheadline text (bound-node resolution), continue_mode (§11.5
  // ownership), design_overrides (§9.5 layer 4). A legacy body carries none →
  // the ctx is the empty-text default and every unbound node renders
  // byte-identically (regression-pinned). No frame context in Phase A
  // (`frame_context` is the 13 §13.4 Phase-C extension).
  const ctxHeadlineRaw = body["headline"] ?? body["headline_text"];
  const ctxSubheadlineRaw = body["subheadline"] ?? body["subheadline_text"];
  const ctxContinueRaw = body["continue_mode"];
  const ctxOverridesRaw = body["design_overrides"] ?? body["design_overrides_json"];
  const sectionCtx: LeadgenSectionRenderCtx = {
    headline_text: typeof ctxHeadlineRaw === "string" ? ctxHeadlineRaw : "",
    subheadline_text: typeof ctxSubheadlineRaw === "string" ? ctxSubheadlineRaw : null,
    design_overrides: parseSectionDesignOverrides(
      typeof ctxOverridesRaw === "string"
        ? ctxOverridesRaw
        : isRecord(ctxOverridesRaw)
          ? JSON.stringify(ctxOverridesRaw)
          : null,
    ),
  };
  if (ctxContinueRaw === "button" || ctxContinueRaw === "auto_advance") {
    sectionCtx.continue_mode = ctxContinueRaw;
  }

  // --- v2.5 13 §13.4 frame_context (ADDITIVE, Phase C) ----------------------
  // Present → resolve (funnel ⊕ optional variant ⊕ optional site) into the
  // effective composition; the unit below renders under the EFFECTIVE design
  // and composes inside renderQuoteFrame. Absent → frame stays null and the
  // unit-only path runs byte-identically (regression-pinned).
  let frame: SectionPreviewFrame | null = null;
  if (body["frame_context"] !== undefined && body["frame_context"] !== null) {
    const resolvedFrame = await resolveSectionPreviewFrame(
      c.env.DB,
      body["frame_context"],
      typeof rawDesignId === "string" ? rawDesignId : null,
    );
    if (resolvedFrame.kind === "invalid") {
      return c.json({ error: "Validation failed", fields: resolvedFrame.fields }, 400);
    }
    if (resolvedFrame.kind === "not_found") return c.json({ error: "Not Found" }, 404);
    frame = resolvedFrame.frame;
    // 13 §13.1 bullet 4 / §11.5: a composed frame owns the Continue placement —
    // thread the section_slot fields exactly like renderVariantSectionsHtml.
    if (frame.composition !== null) {
      sectionCtx.continue_placement = frame.composition.frame.section_slot.continue_placement;
      sectionCtx.continue_style_role = frame.composition.frame.section_slot.continue_style_role;
    }
  }
  // The design the UNIT renders under: the frame's effective (layers 1–3
  // baked) design when composed; the resolved base otherwise. On the
  // unit-only path this IS `design` — bytes unchanged.
  const renderDesign = (frame?.composition?.effectiveTokens.design ?? design) as FunnelDesign;

  // §12.3/§14.9 conditional-dependency preview: the answers BASIS is the
  // legacy `sample_answers` record overlaid by `sim.answers` overlaid by the
  // §9.2 flow reduction (later entries win). Any basis — or the explicit
  // "dependency" sim — normalizes (answers.ts §12.7) and runs the Stage-A
  // evaluateDependencies over the draft component nodes, so hidden components
  // are ACTUALLY hidden in the markup, exactly as the P7 runtime hides them.
  // No basis ⇒ the classic full-render preview (unchanged, byte-compatible).
  const nodes = content.components as LeadgenComponentNode[];
  const rawSample = body["sample_answers"] ?? body["answers"];
  const flowAnswers: Record<string, unknown> = {};
  for (const step of sim.flow) flowAnswers[step.internal_field] = step.value;
  const hasAnswerBasis = isRecord(rawSample) || sim.answers !== null || sim.flow.length > 0;
  const mergedRawAnswers: Record<string, unknown> = {
    ...(isRecord(rawSample) ? (rawSample as Record<string, unknown>) : {}),
    ...(sim.answers ?? {}),
    ...flowAnswers,
  };

  let dependencies: LeadgenDependencyState | null = null;
  let normalizedAnswers: Record<string, unknown> = {};
  let visible: Set<string> | null = null;
  let rendered: string;
  let componentCount: number;
  if (hasAnswerBasis || sim.state === "dependency") {
    const normalized = normalizeAnswers(content, mergedRawAnswers as LeadgenRawAnswers);
    normalizedAnswers = normalized.answers;
    // evaluateDependencies runs over the §8.5 flattened LEAF projection (its
    // own canonical flatten) — nested questions participate like top-level.
    dependencies = evaluateDependencies(nodes, normalized.answers);
    visible = new Set(
      dependencies.components.filter((cc) => cc.visible).map((cc) => cc.question_id),
    );
    // Filter the render to the visible LEAVES only — a component whose inline
    // conditional is unmet (or fail-closed on an unanswered `when`) is dropped
    // from the previewed HTML, exactly as the P7 runtime will hide it. §8.5:
    // container WRAPPERS are kept (layout chrome) while hidden leaf nodes
    // inside them drop — renderSectionComponentsVisible walks the full tree.
    // For flat content this equals the classic filter-then-render, byte for
    // byte. v2.5 Phase C (DEV-57): the §3.4 sectionCtx now threads through the
    // Visible walk too — a legacy body's empty-default ctx renders
    // byte-identically (pinned); a body naming headline/continue/overrides
    // gets bound text + §11.5 + layer-4 in dependency sims as well.
    rendered = renderSectionComponentsVisible(nodes, renderDesign, visible, sectionCtx);
    // The count mirrors what renders: visible LEAF nodes (flat content: the
    // exact pre-§8.5 filtered-list length — flatten is the identity there).
    componentCount = flattenComponents(nodes).filter(
      (n) => isRecord(n) && typeof n.question_id === "string" && visible!.has(n.question_id),
    ).length;
  } else {
    // No basis ⇒ the classic full-render preview; the renderer receives the
    // FULL tree (container presets recurse) + the §3.4 sectionCtx (legacy
    // bodies produce the empty-default ctx → byte-identical output).
    rendered = renderSectionComponents(nodes, renderDesign, sectionCtx);
    componentCount = nodes.length;
  }

  // §9.2: every sim is SERVER-rendered INTO the markup (selected classes,
  // error markup, success markup) — the outer-iframe attribute hacks are
  // gone. Selection also rides a provided flow (its record is the
  // dependency+selected basis).
  const markSelection = sim.state === "selected" || sim.flow.length > 0;
  if (
    markSelection ||
    sim.state === "error" ||
    sim.state === "validation_success" ||
    sim.state === "validation_error"
  ) {
    rendered = applyPreviewSimMarkup(rendered, nodes, renderDesign, {
      state: sim.state,
      markSelection,
      answers: normalizedAnswers,
      visibleIds: visible,
      requiredNow:
        dependencies === null
          ? null
          : new Map(dependencies.components.map((cc) => [cc.question_id, cc.required_now])),
    });
  }

  // --- v2.5 13 §13.4 frame_context render (composed early-return) -----------
  // The CURRENT unit — sim/dependency markup included — rides ONE §3.2 section
  // wrapper (byte-exactly the renderVariantSectionsHtml shape, index 0
  // visible) inside renderQuoteFrame; a NULL/invalid stored frame composes
  // through the byte-pinned legacy shell (§13.1 fork). The response keeps the
  // unit-only shape; the composed body is viewport-invariant (the builder
  // iframes the real widths — the variant-preview §8.9 idiom), so desktop /
  // mobile / html carry the same bytes. The unit-only tail below stays
  // untouched — the legacy path is byte-identical by construction.
  if (frame !== null) {
    const sectionPublicId =
      typeof body["section_public_id"] === "string" && body["section_public_id"] !== ""
        ? (body["section_public_id"] as string)
        : "lgs_preview";
    const screenLabel = `01 · ${sectionCtx.headline_text}`;
    const sectionsHtml =
      `<section data-lg-section data-lg-section-id="${escapeHtml(sectionPublicId)}"` +
      ` data-lg-index="0" data-screen-label="${escapeHtml(screenLabel)}">` +
      rendered +
      `</section>`;
    // Root identity: real funnel/quote ids; the variant leg is honest — the
    // resolved variant's id/content_version, or the preview placeholder when
    // the caller pinned no variant (the events-doc idiom, never a faked id).
    const composed =
      frame.composition === null
        ? renderLegacyShell({
            designId: frame.design.id,
            funnelId: frame.funnelPublicId,
            funnelVariantId: frame.variantPublicId ?? "lgn_preview",
            quoteId: frame.quotePublicId,
            contentVersion: frame.variantContentVersion ?? 0,
            sectionsHtml,
            bannersMountHtml: LG_BANNERS_MOUNT_HTML,
          })
        : renderQuoteFrame({
            effectiveTokens: frame.composition.effectiveTokens,
            frame: frame.composition.frame,
            siteBranding: frame.branding,
            sectionsHtml,
            bannersMountHtml: LG_BANNERS_MOUNT_HTML,
            sectionCount: frame.sectionCount,
            root: {
              funnelId: frame.funnelPublicId,
              funnelVariantId: frame.variantPublicId ?? "lgn_preview",
              quoteId: frame.quotePublicId,
              contentVersion: frame.variantContentVersion ?? 0,
            },
          });
    const { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } = await import(
      "../../public/leadgen/designs/default-funnel/styles"
    );
    const scope = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${frame.design.id}"]`;
    // The SAME css fork the runtime shell + variant preview take: effective
    // tokens + frame-region rules when composed; the plain base sheet on the
    // legacy-shell fork.
    const css =
      frame.composition === null
        ? funnelChromeCss(frame.design, scope)
        : funnelChromeCss(frame.composition.effectiveTokens.design, scope, { frameRegions: true });
    const preview: Record<string, unknown> = {
      css,
      desktop: composed,
      mobile: composed,
      component_count: componentCount,
      design_id: frame.design.id,
      sim_state: sim.state,
    };
    if (viewport !== undefined) preview["html"] = composed;
    const responseBody: Record<string, unknown> = { preview };
    if (dependencies !== null) {
      responseBody["dependencies"] = {
        components: dependencies.components,
        continue_blocked: dependencies.continue_blocked,
        blocking_question_ids: dependencies.blocking_question_ids,
        visible_question_ids: dependencies.components
          .filter((cc) => cc.visible)
          .map((cc) => cc.question_id),
      };
    }
    return c.json(responseBody);
  }

  const wrap = (wrapViewport: "desktop" | "mobile", maxWidth: string): string =>
    `<div data-funnel-design="${design.id}" data-viewport="${wrapViewport}" class="lg-preview lg-preview-${wrapViewport}" style="max-width:${maxWidth};margin:0 auto"><div class="lg-content">${rendered}</div></div>`;

  // The scoped chrome CSS is imported lazily so this handler stays free of the
  // styles module unless a preview is requested. The scope attribute value is
  // the RESOLVED design id (the serve.ts funnel-shell pattern) — for the
  // default design this equals the module's DEFAULT_FUNNEL_SCOPE, so legacy
  // bodies stay byte-identical.
  const { funnelChromeCss, FUNNEL_DESIGN_SCOPE_ATTR } = await import(
    "../../public/leadgen/designs/default-funnel/styles"
  );
  const desktopHtml = wrap("desktop", design.header.contentMaxWidth);
  const mobileHtml = wrap("mobile", design.breakpoints.mobileMax);
  const preview: Record<string, unknown> = {
    css: funnelChromeCss(design, `[${FUNNEL_DESIGN_SCOPE_ATTR}="${design.id}"]`),
    desktop: desktopHtml,
    mobile: mobileHtml,
    component_count: componentCount,
    // §9.2 additive echoes: the RESOLVED design id + the RESOLVED sim state
    // ("default" when the caller sent none).
    design_id: design.id,
    sim_state: sim.state,
  };
  // When the caller names a viewport, ALSO return that viewport's markup as
  // preview.html (the Studio srcdoc consumes it directly).
  if (viewport !== undefined) preview["html"] = viewport === "mobile" ? mobileHtml : desktopHtml;

  // --- §9.1 / §8.9 (Slice D2) runtime-hydrated events document -------------
  // ADDITIVE `runtime: true` body flag: the response gains
  // preview.events_html — a COMPLETE srcdoc document that mirrors the live
  // funnel shell's structural contract (03 §3.2): #lg-funnel-root +
  // data-lg-mount + ONE [data-lg-section] block wrapping the SAME rendered
  // markup, the #lg-config LeadgenPublicConfig-shaped blob (components through
  // the REAL toPublicComponent projection), and the SAME versioned runtime
  // script URL the shell embeds. The root carries data-lg-preview="1", so the
  // engine (engine.ts §9.1 contract) suppresses real beacons and postMessages
  // would-fire events to the parent — the Studio's "events that would fire"
  // panel. The auction call is disabled by the same flag. Identity fields are
  // HONEST preview placeholders (lg?_preview) — never faked live ids.
  if (body["runtime"] === true) {
    const sectionPublicId =
      typeof body["section_public_id"] === "string" && body["section_public_id"] !== ""
        ? (body["section_public_id"] as string)
        : "lgs_preview";
    const headline = typeof body["headline"] === "string" ? (body["headline"] as string) : "";
    const continueMode = body["continue_mode"] === "auto_advance" ? "auto_advance" : "button";
    const addressValidation = body["address_validation_enabled"] === true;
    const previewConfig = {
      quote_id: "lgq_preview",
      funnel_id: "lgf_preview",
      funnel_variant_id: "lgn_preview",
      funnel_name: "Studio preview",
      content_version: 0,
      funnel_design_id: design.id,
      design_tokens: design as unknown as Record<string, unknown>,
      section_order_hash: "preview",
      ga4_measurement_id: null,
      funnel_ab_test_id: "",
      funnel_ab_test_revision: 0,
      variant_label: "preview",
      traffic_allocation_bp: 10000,
      assignment_reason: "single_control",
      sections: [
        {
          section_public_id: sectionPublicId,
          section_index: 0,
          headline,
          continue_mode: continueMode,
          address_validation_enabled: addressValidation,
          section_mapping_version: 0,
          answer_mapping_version: "",
          // The FULL flattened component list (the engine applies dependency
          // visibility itself, exactly as on the live shell).
          components: flattenComponents(nodes).map(toPublicComponent),
        },
      ],
    };
    const configJson = JSON.stringify(previewConfig).replace(/</g, "\\u003c");
    const screenLabel = `01 · ${headline}`;
    // One shell-shaped srcdoc builder for BOTH preview documents. With
    // extraRootAttrs="" and the config+runtime scripts the output is
    // byte-identical to the pre-§14.9-fix events_html (regression-pinned).
    const shellDoc = (extraRootAttrs: string, scripts: string): string =>
      "<!doctype html>" +
      '<html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<style>${preview["css"] as string}</style></head><body>` +
      `<div id="lg-funnel-root" data-lg-preview="1"${extraRootAttrs} ${FUNNEL_DESIGN_SCOPE_ATTR}="${escapeHtml(design.id)}"` +
      ` data-funnel-id="lgf_preview" data-funnel-variant-id="lgn_preview" data-quote-id="lgq_preview"` +
      ` data-content-version="0" data-viewport="${viewport === "mobile" ? "mobile" : "desktop"}"` +
      ` class="lg-preview lg-preview-${viewport === "mobile" ? "mobile" : "desktop"}"` +
      ` style="max-width:${viewport === "mobile" ? design.breakpoints.mobileMax : design.header.contentMaxWidth};margin:0 auto">` +
      '<main class="lg-content" data-lg-mount>' +
      `<section data-lg-section data-lg-section-id="${escapeHtml(sectionPublicId)}" data-lg-index="0" data-screen-label="${escapeHtml(screenLabel)}">` +
      rendered +
      "</section>" +
      '<div class="lg-banners" data-lg-banners hidden></div>' +
      "</main></div>" +
      scripts +
      "</body></html>";
    preview["events_html"] = shellDoc(
      "",
      `<script type="application/json" id="lg-config">${configJson}</script>` +
        // The BYTE-IDENTICAL bundle /lg/runtime/{LEADGEN_TEMPLATE_VERSION}.js
        // serves, inlined (see the import note: /lg/* is site-scoped and 404s on
        // the admin host, so the srcdoc cannot script-src it there). The version
        // rides as a data attribute for observability; the `</script` escape is
        // a defensive no-op today (the generated bundle contains none — any
        // future occurrence must sit inside a JS string/regex where `<\/` is
        // byte-equivalent).
        `<script data-lg-runtime-version="${LEADGEN_TEMPLATE_VERSION}">${LEADGEN_RUNTIME_JS.replace(/<\/script/gi, "<\\/script")}</script>`,
    );
    // §9.2/§14.9: a NON-default sim is a server-rendered STILL. The MAIN
    // preview document must NOT hydrate — engine boot re-applies dependency
    // visibility from an EMPTY answer store (preview skips snapshot restore,
    // engine.ts §3.5.1) and re-hides the very reveal the sim rendered. A
    // static document has nothing to hydrate, so it carries data-lg-ready="1"
    // by construction. The events panel keeps its §8.9 stream from
    // events_html above — the SEPARATE runtime-bearing document the island
    // loads into its hidden probe frame. Default state keeps full hydration
    // (events_html IS the main document there — unchanged).
    if (sim.state !== "default") {
      preview["static_html"] = shellDoc(' data-lg-ready="1"', "");
    }
  }
  const responseBody: Record<string, unknown> = { preview };
  if (dependencies !== null) {
    responseBody["dependencies"] = {
      components: dependencies.components,
      continue_blocked: dependencies.continue_blocked,
      blocking_question_ids: dependencies.blocking_question_ids,
      visible_question_ids: dependencies.components
        .filter((cc) => cc.visible)
        .map((cc) => cc.question_id),
    };
  }
  return c.json(responseBody);
}

// ---------------------------------------------------------------------------
// GET /sections/:id/usage — Quotes/variants using it (P7 join)
// ---------------------------------------------------------------------------

// The §7.3 P7 tables (leadgen_funnel_variant_sections → variants → funnels →
// quotes) exist in migration 0036, so this is a real join (not a derivable
// approximation). A Section is "used" when a funnel variant orders it.
export async function sectionUsageHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const usage = await c.env.DB.prepare(
    `SELECT DISTINCT q.id AS quote_id, q.public_id AS quote_public_id, q.quote_name, q.status AS quote_status,
            f.public_id AS funnel_public_id, f.funnel_name,
            v.public_id AS variant_public_id, v.variant_label, v.status AS variant_status,
            fvs.position
     FROM leadgen_funnel_variant_sections fvs
     JOIN leadgen_funnel_variants v ON v.id = fvs.variant_id
     JOIN leadgen_funnels f ON f.id = v.funnel_id
     JOIN leadgen_quotes q ON q.id = f.quote_id
     WHERE fvs.section_id = ?
     ORDER BY q.quote_name ASC, v.variant_label ASC, fvs.position ASC`,
  )
    .bind(row.id)
    .all();
  return c.json({ usage: { variants: usage.results ?? [] } });
}

// ---------------------------------------------------------------------------
// GET /sections/:id/offers — available Offers for activity+vertical + mappings
// ---------------------------------------------------------------------------

// §8.7 (E2): one ANSWER-source field of an Offer's ACTIVE payload schema —
// the mapping panel's grid rows. Projected from the §11.5 flat-node shape;
// only `source:"answer"` nodes are mappable (macro/token/computed nodes are
// server-side concerns and never appear here).
export interface SectionOfferAnswerField {
  path: string;
  type: string;
  required: boolean;
  internal_field: string | null;
  label: string | null;
  // v2.5 12 §12.5 ADDITIVE: the operator display label the §12.1 mapping
  // panel's Field column shows — authored schema label, else the humanized
  // leaf segment. Derived at projection time; no storage change.
  field_label: string;
  valid_values: Array<string | number | boolean> | null;
}

// Parse a schema_json blob into its answer-source field list. Defensive
// against corrupt stored JSON (D1 rule) — a bad blob yields [].
function schemaAnswerSourceFields(schemaJson: string | null): SectionOfferAnswerField[] {
  const out: SectionOfferAnswerField[] = [];
  const parsed = parseJsonColumn(schemaJson);
  if (!isRecord(parsed) || !isRecord(parsed["root"]) || !Array.isArray(parsed["root"]["children"])) {
    return out;
  }
  for (const node of parsed["root"]["children"]) {
    if (!isRecord(node)) continue;
    if (node["source"] !== "answer") continue;
    const path = node["path"];
    const type = node["type"];
    if (typeof path !== "string" || path === "" || typeof type !== "string" || !PAYLOAD_NODE_TYPES.has(type)) {
      continue;
    }
    const validValues = Array.isArray(node["valid_values"])
      ? (node["valid_values"] as unknown[]).filter(
          (v): v is string | number | boolean =>
            typeof v === "string" || typeof v === "number" || typeof v === "boolean",
        )
      : null;
    out.push({
      path,
      type,
      required: node["required"] === true,
      internal_field: trimmedString(node["internal_field"]),
      label: trimmedString(node["label"]),
      field_label: deriveFieldLabel(node["label"], path),
      valid_values: validValues !== null && validValues.length > 0 ? validValues : null,
    });
  }
  return out;
}

export async function sectionOffersHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);

  // §12.4: only Offers matching the Section's activity AND vertical are shown.
  // §8.7 additive columns: the ACTIVE schema's version/public_id/schema_json
  // (for the answer_fields projection) + the Offer's DEFAULT placement id —
  // the mapping table's Placement/Payload-schema-version cells.
  const offers = await c.env.DB.prepare(
    `SELECT o.id, o.public_id, o.offer_name, o.provider, o.activity, o.vertical, o.offer_type,
            o.status, o.active_payload_schema_id,
            ps.version AS payload_schema_version, ps.public_id AS payload_schema_public_id,
            ps.schema_json AS active_schema_json,
            pl.placement_id AS default_placement_id,
            sao.selected, sao.mapping_state, sao.required_fields_total, sao.required_fields_mapped
     FROM leadgen_offers o
     LEFT JOIN leadgen_offer_payload_schemas ps ON ps.id = o.active_payload_schema_id
     LEFT JOIN leadgen_offer_placements pl ON pl.offer_id = o.id AND pl.is_default = 1
     LEFT JOIN leadgen_section_available_offers sao ON sao.offer_id = o.id AND sao.section_id = ?
     WHERE o.activity = ? AND o.vertical = ? AND o.status = 'active'
     ORDER BY o.offer_name ASC, o.id ASC`,
  )
    .bind(row.id, row.activity, row.vertical)
    .all<{
      id: number;
      public_id: string;
      offer_name: string;
      provider: string | null;
      activity: string;
      vertical: string;
      offer_type: string;
      status: string;
      active_payload_schema_id: number | null;
      payload_schema_version: number | null;
      payload_schema_public_id: string | null;
      active_schema_json: string | null;
      default_placement_id: string | null;
      selected: number | null;
      mapping_state: string | null;
      required_fields_total: number | null;
      required_fields_mapped: number | null;
    }>();

  const maps = await readAnswerMaps(c.env.DB, row.id);
  return c.json({
    // §8.2: echo the SAVED pair the derivation used — the E9 empty state names
    // exactly these values.
    activity: row.activity,
    vertical: row.vertical,
    offers: (offers.results ?? []).map((o) => ({
      id: o.id,
      public_id: o.public_id,
      offer_name: o.offer_name,
      provider: o.provider,
      activity: o.activity,
      vertical: o.vertical,
      offer_type: o.offer_type,
      status: o.status,
      has_active_schema: o.active_payload_schema_id !== null,
      // §8.7 additive fields (the E2 mapping panel):
      payload_schema_version: o.payload_schema_version,
      payload_schema_public_id: o.payload_schema_public_id,
      default_placement_id: o.default_placement_id,
      answer_fields: schemaAnswerSourceFields(o.active_schema_json),
      selected: o.selected !== null && o.selected !== 0,
      mapping_state: o.mapping_state,
      required_fields_total: o.required_fields_total ?? 0,
      required_fields_mapped: o.required_fields_mapped ?? 0,
    })),
    mappings: maps.map(answerMapRowToApi),
  });
}

// ---------------------------------------------------------------------------
// GET /sections/:id/analytics — §12.9 metrics (NULLIF ratios; no raw free-text)
// ---------------------------------------------------------------------------

interface SectionMetricRow {
  views: number | null;
  clicks: number | null;
  continued: number | null;
  validation_errors: number | null;
  default_applied: number | null;
  user_confirmed_default: number | null;
  user_selected: number | null;
  time_on_section_ms_sum: number | null;
  dropoffs: number | null;
  continue_rate: number | null;
  validation_error_rate: number | null;
  default_answer_rate: number | null;
  user_changed_default_rate: number | null;
  dropoff_rate: number | null;
  avg_time_on_section_ms: number | null;
}

export async function sectionAnalyticsHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }

  // §12.9 ratios computed at read, NULLIF-guarded (a zero denominator → NULL,
  // never a fake 0; the UI renders "—", §9.1).
  const metrics = await c.env.DB.prepare(
    `SELECT
        SUM(views) AS views,
        SUM(clicks) AS clicks,
        SUM(continued) AS continued,
        SUM(validation_errors) AS validation_errors,
        SUM(default_applied) AS default_applied,
        SUM(user_confirmed_default) AS user_confirmed_default,
        SUM(user_selected) AS user_selected,
        SUM(time_on_section_ms_sum) AS time_on_section_ms_sum,
        SUM(dropoffs) AS dropoffs,
        CAST(SUM(continued) AS REAL) / NULLIF(SUM(views), 0) AS continue_rate,
        CAST(SUM(validation_errors) AS REAL) / NULLIF(SUM(views), 0) AS validation_error_rate,
        CAST(SUM(default_applied) AS REAL) / NULLIF(SUM(default_applied) + SUM(user_confirmed_default) + SUM(user_selected), 0) AS default_answer_rate,
        CAST(SUM(user_selected) AS REAL) / NULLIF(SUM(default_applied) + SUM(user_confirmed_default) + SUM(user_selected), 0) AS user_changed_default_rate,
        CAST(SUM(dropoffs) AS REAL) / NULLIF(SUM(views), 0) AS dropoff_rate,
        CAST(SUM(time_on_section_ms_sum) AS REAL) / NULLIF(SUM(views), 0) AS avg_time_on_section_ms
     FROM leadgen_analytics_section
     WHERE section_public_id = ? AND date BETWEEN ? AND ?`,
  )
    .bind(row.public_id, range.from, range.to)
    .first<SectionMetricRow>();

  // §12.9 answer_distribution — value · count · percentage per question. The
  // mirror stores answer_value_normalized ONLY (raw free-text is suppressed at
  // the source per §30.3), so this read never exposes raw PII. Percentage is
  // per-question (NULLIF-guarded against a zero question total).
  const distRows = await c.env.DB.prepare(
    `SELECT question_key, answer_value_normalized, answer_source,
            SUM(count) AS count, SUM(continued_count) AS continued_count
     FROM leadgen_analytics_answer_distribution
     WHERE section_public_id = ? AND date BETWEEN ? AND ?
     GROUP BY question_key, answer_value_normalized, answer_source
     ORDER BY question_key ASC, count DESC`,
  )
    .bind(row.public_id, range.from, range.to)
    .all<{
      question_key: string;
      answer_value_normalized: string;
      answer_source: string;
      count: number;
      continued_count: number;
    }>();

  const perQuestionTotal = new Map<string, number>();
  for (const d of distRows.results ?? []) {
    perQuestionTotal.set(d.question_key, (perQuestionTotal.get(d.question_key) ?? 0) + Number(d.count ?? 0));
  }
  const answer_distribution = (distRows.results ?? []).map((d) => {
    const total = perQuestionTotal.get(d.question_key) ?? 0;
    return {
      question_key: d.question_key,
      answer_value_normalized: d.answer_value_normalized,
      answer_source: d.answer_source,
      count: Number(d.count ?? 0),
      continued_count: Number(d.continued_count ?? 0),
      // NULLIF-equivalent: a zero question total → null percentage, not 0.
      percentage: total > 0 ? Number(d.count ?? 0) / total : null,
    };
  });

  return c.json({
    analytics: {
      from: range.from,
      to: range.to,
      views: metrics?.views ?? 0,
      clicks: metrics?.clicks ?? 0,
      users_continued_to_next_page: metrics?.continued ?? 0,
      validation_errors: metrics?.validation_errors ?? 0,
      default_applied: metrics?.default_applied ?? 0,
      user_confirmed_default: metrics?.user_confirmed_default ?? 0,
      user_selected: metrics?.user_selected ?? 0,
      dropoffs: metrics?.dropoffs ?? 0,
      time_on_section_ms_sum: metrics?.time_on_section_ms_sum ?? 0,
      continue_rate: metrics?.continue_rate ?? null,
      validation_error_rate: metrics?.validation_error_rate ?? null,
      default_answer_rate: metrics?.default_answer_rate ?? null,
      user_changed_default_rate: metrics?.user_changed_default_rate ?? null,
      dropoff_rate: metrics?.dropoff_rate ?? null,
      avg_time_on_section_ms: metrics?.avg_time_on_section_ms ?? null,
      answer_distribution,
    },
  });
}

// ---------------------------------------------------------------------------
// POST /sections/:id/validate-payload — §12.11 per-Offer preview
// ---------------------------------------------------------------------------

// Given sample answers + selected Offers, return per Offer: the generated
// payload (answers.ts→payload.ts), a completeness score (mapped required /
// total required), and the missing/invalid fields. The mapping edges are the
// PERSISTED ones (this validates the saved Section against sample input).
export async function validateSectionPayloadHandler(c: AdminContext): Promise<Response> {
  const row = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (row === null) return c.json({ error: "Not Found" }, 404);
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const rawAnswers: LeadgenRawAnswers = isRecord(body["answers"]) ? (body["answers"] as LeadgenRawAnswers) : {};
  const content = parseComponents(row.content_json);
  const normalized = normalizeAnswers(content, rawAnswers);

  const storedMaps = await readAnswerMaps(c.env.DB, row.id);
  // Optional offer filter (numeric ids or lgo_ public ids).
  const filter = new Set<number>();
  const rawOffers = body["offer_ids"] ?? body["offers"];
  const publicFilter = new Set<string>();
  if (Array.isArray(rawOffers)) {
    for (const item of rawOffers) {
      if (typeof item === "number" && Number.isInteger(item)) filter.add(item);
      else if (typeof item === "string" && isPublicId("offer", item)) publicFilter.add(item);
    }
  }
  if (publicFilter.size > 0) {
    for (const ids of chunk([...publicFilter])) {
      const rows = await c.env.DB.prepare(
        `SELECT id, public_id FROM leadgen_offers WHERE public_id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(...ids)
        .all<{ id: number; public_id: string }>();
      for (const r of rows.results ?? []) filter.add(r.id);
    }
  }

  // Load the ACTIVE payload schemas for every stored-map Offer ONCE — the
  // superset that the filtered per-Offer preview AND the section-level rebuild
  // both read (loadOfferSchemas returns a Map; a filtered id looks up the same
  // info). Avoids the prior duplicate load of the same schemas.
  const allOfferIds = [...new Set(storedMaps.map((m) => m.offer_id))];
  const offerSchemas = await loadOfferSchemas(c.env.DB, allOfferIds);
  const offerIds = allOfferIds.filter((id) => filter.size === 0 || filter.has(id));

  const results = offerIds.map((offerId) => {
    const edges = storedMaps.filter((m) => m.offer_id === offerId);
    const offerSchema = offerSchemas.get(offerId) ?? null;
    const mappings: LeadgenAnswerMapping[] = edges.map((e) => ({
      internal_field: e.internal_field,
      offer_payload_field_path: e.offer_payload_field_path,
      provider_expected_type: e.provider_expected_type,
      output_value_map: parseObjectColumn(e.output_value_map_json),
      value_transform: parseTransformColumn(e.transform_json),
      required_for_offer: e.required_for_offer !== 0,
      default_value: e.default_value ?? undefined,
      fallback_value: e.fallback_value ?? undefined,
    }));
    const payload = buildOfferPayload(mappings, normalized.answers);

    const requiredTotal = offerSchema?.requiredFieldPaths.length ?? 0;
    const mappedRequired = new Set<string>();
    const missing: string[] = [];
    const invalid: Array<{ field: string; reason: string }> = [];
    for (const e of edges) {
      const completeness = mappingCompleteness(
        {
          question_id: e.question_id,
          question_key: e.question_key,
          internal_field: e.internal_field,
          answer_type: e.answer_type,
          offer_id: e.offer_id,
          offer_payload_field_path: e.offer_payload_field_path,
          provider_expected_type: e.provider_expected_type,
          output_value_map: parseObjectColumn(e.output_value_map_json),
          value_transform: parseTransformColumn(e.transform_json),
          required_for_offer: e.required_for_offer !== 0,
          default_value: e.default_value,
          fallback_value: e.fallback_value,
        },
        offerSchema,
      );
      if (completeness === "complete" && offerSchema?.requiredFieldPaths.includes(e.offer_payload_field_path)) {
        mappedRequired.add(e.offer_payload_field_path);
      } else if (completeness === "type_mismatch" || completeness === "orphaned") {
        invalid.push({ field: e.offer_payload_field_path, reason: completeness });
      }
    }
    for (const path of offerSchema?.requiredFieldPaths ?? []) {
      if (!mappedRequired.has(path)) missing.push(path);
    }
    return {
      offer_id: offerId,
      offer_public_id: offerSchema?.active_schema_public_id ?? null,
      payload,
      completeness: {
        required_total: requiredTotal,
        required_mapped: mappedRequired.size,
        // NULLIF-equivalent: 0 required fields → a null score (nothing to score).
        score: requiredTotal > 0 ? mappedRequired.size / requiredTotal : null,
      },
      missing,
      invalid,
    };
  });

  // Derive the section-level publish verdict from the SAME rebuild the save
  // uses, so the preview agrees with the stored validation_status. Reuses the
  // offer schemas loaded once above (superset of the filtered preview set).
  const rebuilt = rebuildDerivedIndexes({
    content,
    answerMaps: storedMaps.map((e) => ({
      question_id: e.question_id,
      question_key: e.question_key,
      internal_field: e.internal_field,
      answer_type: e.answer_type,
      offer_id: e.offer_id,
      offer_payload_field_path: e.offer_payload_field_path,
      provider_expected_type: e.provider_expected_type,
      output_value_map: parseObjectColumn(e.output_value_map_json),
      value_transform: parseTransformColumn(e.transform_json),
      required_for_offer: e.required_for_offer !== 0,
      default_value: e.default_value,
      fallback_value: e.fallback_value,
    })),
    offerSchemas,
  });
  const verdict = sectionValidationStatus(rebuilt);

  return c.json({
    answers: normalized.answers,
    answer_sources: normalized.sources,
    offers: results,
    section_validation: { status: verdict.status, publishable: verdict.publishable },
    // §12.8 server-side ZIP validation over the SAME normalized answers. Null
    // when address validation is off or the Section has no ZIP/Address field
    // (the live geocode/autofill is P7 + operator-key-gated; this admin leg is
    // validation-only and never needs the Maps key).
    address_validation: zipValidation(row, content, normalized.answers),
  });
}

// §12.8 ZIP internal-field discovery: a ZIPInputQuestion contributes its own
// `internal_field`; an AddressAutocompleteQuestion contributes its zip sub-field
// (one of `props.internal_fields`, default set street/city/state/zip). Mirrors
// answers.ts fieldsOf so the fields checked here == the fields normalizeAnswers
// produced (no divergent field vocabulary).
// Mirrors answers.ts `fieldsOf` exactly so the ZIP check probes the SAME
// internal fields normalizeAnswers populates: a top-level `internal_field`
// wins for any node (incl. AddressAutocompleteQuestion); otherwise an
// AddressAutocompleteQuestion expands to `props.internal_fields` (default
// street/city/state/zip). Then keeps only the zip-ish fields.
function zipFieldsOfContent(content: LeadgenSectionContent): string[] {
  const out: string[] = [];
  // §8.5: probe the flattened projection — the SAME leaf universe
  // normalizeAnswers walks — so a nested ZIP/Address component is found.
  for (const node of flattenComponents(content.components)) {
    if (!isRecord(node)) continue;
    const type = node["type"];
    const topField = trimmedString(node["internal_field"]);
    if (type === "ZIPInputQuestion") {
      if (topField !== null) out.push(topField);
    } else if (type === "AddressAutocompleteQuestion") {
      if (topField !== null) {
        // A singular top-level internal_field is what normalizeAnswers uses;
        // count it only if it is itself a ZIP field.
        if (/zip/i.test(topField)) out.push(topField);
      } else {
        const props = isRecord(node["props"]) ? (node["props"] as Record<string, unknown>) : {};
        const fields = Array.isArray(props["internal_fields"])
          ? (props["internal_fields"] as unknown[])
          : ["street", "city", "state", "zip"];
        for (const f of fields) {
          if (typeof f === "string" && /zip/i.test(f)) out.push(f);
        }
      }
    }
  }
  return [...new Set(out)];
}

// §12.8: validate every ZIP answer with maps.validateZip (`/^\d{5}$/`) when the
// Section enabled address validation. Returns per-field {present, valid} + the
// list of malformed fields; null when the leg does not apply.
function zipValidation(
  row: LeadgenSectionRow,
  content: LeadgenSectionContent,
  answers: Readonly<Record<string, unknown>>,
): {
  enabled: boolean;
  zip_fields: string[];
  checks: Array<{ field: string; present: boolean; valid: boolean | null }>;
  malformed: string[];
  has_malformed: boolean;
} | null {
  if (row.address_validation_enabled === 0) return null;
  const fields = zipFieldsOfContent(content);
  if (fields.length === 0) return null;
  const checks = fields.map((field) => {
    const value = answers[field];
    const present = value !== undefined && value !== null && String(value).trim() !== "";
    return { field, present, valid: present ? validateZip(String(value)) : null };
  });
  const malformed = checks.filter((cc) => cc.present && cc.valid === false).map((cc) => cc.field);
  return { enabled: true, zip_fields: fields, checks, malformed, has_malformed: malformed.length > 0 };
}

function parseObjectColumn(raw: string | null): Record<string, unknown> | null {
  const parsed = parseJsonColumn(raw);
  return isRecord(parsed) ? parsed : null;
}

function parseTransformColumn(raw: string | null): LeadgenTransformStep[] | null {
  const parsed = parseJsonColumn(raw);
  return Array.isArray(parsed) ? (parsed as LeadgenTransformStep[]) : null;
}

// ---------------------------------------------------------------------------
// v2.5 06 §6.6 — named component presets (KV `lg-component-presets`)
// ---------------------------------------------------------------------------
//
// GET/POST /component-presets + DELETE /component-presets/:name. Storage: ONE
// admin-scoped KV list under the repo's existing CACHE binding — no migration
// (§6.6 "admin-scoped, no migration"). Each entry:
//   {name, component_type, overrides, props_subset, created_by, created_at}
// A preset captures the node's TYPE + curated design_overrides + LAYOUT props
// — NEVER content/choices/mapping: `overrides` keys are gated by the schema's
// CURATED_DESIGN_OVERRIDE_KEYS; `props_subset` keys by the layout-prop
// whitelist below (scalar token/enum values only). Apply-side merge is
// island-owned (same-type nodes only); `design_preset` on the node holds the
// NAME as provenance only.

export const COMPONENT_PRESETS_KV_KEY = "lg-component-presets";
const COMPONENT_PRESETS_MAX = 200;

// The §6.6 "layout props" capture whitelist: the §8.5 container/grid token
// props + the A6 image-fit component prop. Content/choices/mapping fields can
// never enter a preset (unknown keys are rejected, the §14.8 discipline).
export const PRESET_LAYOUT_PROP_KEYS = [
  "direction",
  "gap",
  "align",
  "columnsDesktop",
  "columnsTablet",
  "columnsMobile",
  "sizing",
  "ratio",
  "mobile",
  "width",
  "background",
  "shadow",
  "radius",
  "padding",
  "size",
  "gradient",
  "layout",
  "image_fit",
] as const;

const PRESET_PROP_KEY_SET: ReadonlySet<string> = new Set(PRESET_LAYOUT_PROP_KEYS);
const PRESET_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set(CURATED_DESIGN_OVERRIDE_KEYS);

interface ComponentPresetEntry {
  name: string;
  component_type: string;
  overrides: Record<string, string | number | boolean>;
  props_subset: Record<string, string | number | boolean>;
  created_by: string | null;
  created_at: number;
}

function isPresetEntry(value: unknown): value is ComponentPresetEntry {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["component_type"] === "string" &&
    isRecord(value["overrides"]) &&
    isRecord(value["props_subset"])
  );
}

// Defensive KV read (the D1 JSON-parse rule applied to KV): a corrupt blob
// yields [] and the next write repairs it.
async function readComponentPresets(kv: KVNamespace): Promise<ComponentPresetEntry[]> {
  const raw = await kv.get(COMPONENT_PRESETS_KV_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPresetEntry) : [];
  } catch {
    return [];
  }
}

// Validate one scalar map side of the preset body (overrides / props_subset):
// keys ⊆ the given whitelist, values scalar token refs (string|number|boolean)
// — never objects/arrays (no content smuggling), never raw CSS strings beyond
// what the schema itself would accept on the node.
function parsePresetScalarMap(
  raw: unknown,
  field: string,
  allowed: ReadonlySet<string>,
  errors: FieldErrors,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (raw === undefined || raw === null) return out;
  if (!isRecord(raw)) {
    errors[field] = `${field} must be an object of token values`;
    return out;
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.has(key)) {
      errors[`${field}.${key}`] = `'${key}' is not a preset-capturable key (§6.6 — layout/design tokens only)`;
      continue;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      errors[`${field}.${key}`] = `${field}.${key} must be a scalar token value`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function listComponentPresetsHandler(c: AdminContext): Promise<Response> {
  const items = await readComponentPresets(c.env.CACHE);
  return c.json({ items });
}

export async function createComponentPresetHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const errors: FieldErrors = {};
  const name = trimmedString(body["name"]);
  if (name === null) errors["name"] = "name is required";
  else if (name.length > 64) errors["name"] = "name must be 64 characters or fewer";
  const componentType = trimmedString(body["component_type"]);
  if (componentType === null || !(componentType in COMPONENT_CATALOG)) {
    errors["component_type"] = "component_type must be a known component type";
  }
  const overrides = parsePresetScalarMap(body["overrides"], "overrides", PRESET_OVERRIDE_KEY_SET, errors);
  const propsSubset = parsePresetScalarMap(body["props_subset"], "props_subset", PRESET_PROP_KEY_SET, errors);
  if (Object.keys(errors).length > 0) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }

  const entry: ComponentPresetEntry = {
    name: name as string,
    component_type: componentType as string,
    overrides,
    props_subset: propsSubset,
    // Behind Cloudflare Access this header carries the operator identity;
    // absent (tests / bypass) → null, never a fake value.
    created_by: trimmedString(c.req.header("cf-access-authenticated-user-email")),
    created_at: Math.floor(Date.now() / 1000),
  };
  const existing = await readComponentPresets(c.env.CACHE);
  // Upsert by name (an operator re-saving a preset replaces it in place).
  const others = existing.filter((p) => p.name !== entry.name);
  if (others.length >= COMPONENT_PRESETS_MAX) {
    return c.json(
      { error: "Validation failed", fields: { name: `preset list is full (${COMPONENT_PRESETS_MAX} max) — delete one first` } },
      400,
    );
  }
  const items = [...others, entry];
  await c.env.CACHE.put(COMPONENT_PRESETS_KV_KEY, JSON.stringify(items));
  return c.json({ item: entry, items }, 201);
}

export async function deleteComponentPresetHandler(c: AdminContext): Promise<Response> {
  const name = (c.req.param("name") ?? "").trim();
  if (name === "") return c.json({ error: "Not Found" }, 404);
  const existing = await readComponentPresets(c.env.CACHE);
  const items = existing.filter((p) => p.name !== name);
  if (items.length === existing.length) return c.json({ error: "Not Found" }, 404);
  await c.env.CACHE.put(COMPONENT_PRESETS_KV_KEY, JSON.stringify(items));
  return c.json({ ok: true, items });
}
