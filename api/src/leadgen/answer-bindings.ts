// The question→payload-field bindings, read from THE source of truth: the
// Section tab's mapping rows (leadgen_section_answer_maps).
//
// OWNER RULING 2026-08-12 (verbatim): "if a question could map a field in the
// section and field could be mapped as well in the payload you are literally
// creating a conflict which I have never asked for. there should be only one
// source of truth and this is the section tab and not the payload. in the
// payload we declare that the source is answer, and then in the sections we
// show all the fields of all the offers that relevant to the activity **and**
// vertical and we should map it **only** over there."
//
// The design already said so (05 §12.11: "Each leadgen_section_answer_maps edge
// becomes a payload node ... source='answer', internal_field, value_map,
// transform, default/fallback") — answers.ts has carried that construction all
// along. What was missing is THIS: nothing loaded those rows at auction time, so
// the runtime resolved answers from a hand-typed internal_field on the payload
// node instead. This module is the loader that closes it, and it is the ONLY
// place a binding enters the runtime.
//
// Ownership split, enforced here and in payload.ts bindAnswerNode:
//   Payload builder (per Offer)  — which fields exist: path, JSON key, type,
//                                  required, enum domain, source kind, static/
//                                  macro/computed values, conditionals.
//   Section tab (per question)   — which question fills each answer field, and
//                                  that question's per-Offer value map /
//                                  transform / default / fallback.

import type { D1Database } from "@cloudflare/workers-types";
import { answerMappingToBinding, type LeadgenAnswerMapping } from "./answers";
import type { LeadgenAnswerBinding, LeadgenTransformStep } from "./payload";

// Bindings for ONE Offer, keyed by the payload field PATH. Several Sections may
// map one path; the list is in the caller's Section order (payload.ts picks the
// first whose answer is present).
export type LeadgenOfferAnswerBindings = Record<string, LeadgenAnswerBinding[]>;

// offer_id → its bindings.
export type LeadgenAnswerBindingsByOffer = Map<number, LeadgenOfferAnswerBindings>;

interface AnswerMapRow {
  section_id: number;
  offer_id: number;
  internal_field: string;
  offer_payload_field_path: string;
  provider_expected_type: string;
  output_value_map_json: string | null;
  transform_json: string | null;
  required_for_offer: number;
  default_value: string | null;
  fallback_value: string | null;
}

// D1 rule: chunk every IN() list at 80 bindings (100-binding statement limit).
const BIND_CHUNK = 80;

function parseJsonColumn(raw: string | null): unknown {
  if (raw === null || raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // A corrupt mapping column is NOT a runtime failure: the binding keeps its
    // pivot (internal_field) and loses only the malformed leg. Never a throw on
    // the money path.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A stored default/fallback column is TEXT: JSON when it parses (so true/3/null
// keep their type), otherwise the literal string the operator typed.
function parseSlot(raw: string | null): unknown {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function rowToMapping(row: AnswerMapRow): LeadgenAnswerMapping {
  const map = parseJsonColumn(row.output_value_map_json);
  const transform = parseJsonColumn(row.transform_json);
  return {
    internal_field: row.internal_field,
    offer_payload_field_path: row.offer_payload_field_path,
    provider_expected_type: row.provider_expected_type,
    output_value_map: isRecord(map) ? map : null,
    value_transform: Array.isArray(transform) ? (transform as LeadgenTransformStep[]) : null,
    required_for_offer: row.required_for_offer === 1,
    default_value: parseSlot(row.default_value),
    fallback_value: parseSlot(row.fallback_value),
  };
}

/**
 * Read the answer bindings for a set of Offers, optionally narrowed to the
 * Sections a lead actually passed through.
 *
 *  - `sectionIds` omitted  → every Section that maps these Offers (the Offer
 *    Test tab / dry run: "what would production send for this Offer").
 *  - `sectionIds` given    → only those Sections, and the returned per-path
 *    lists follow THAT order (the live auction: the lead's own Sections, in the
 *    order the funnel asked them).
 *
 * One statement per chunk; no per-Offer N+1.
 */
export async function readAnswerBindings(
  db: D1Database,
  offerIds: readonly number[],
  sectionIds?: readonly number[],
): Promise<LeadgenAnswerBindingsByOffer> {
  const out: LeadgenAnswerBindingsByOffer = new Map();
  const offers = Array.from(new Set(offerIds));
  if (offers.length === 0) return out;
  const sections = sectionIds === undefined ? undefined : Array.from(new Set(sectionIds));
  if (sections !== undefined && sections.length === 0) return out;

  const columns =
    "section_id, offer_id, internal_field, offer_payload_field_path, provider_expected_type, " +
    "output_value_map_json, transform_json, required_for_offer, default_value, fallback_value";

  const rows: AnswerMapRow[] = [];
  // Chunk the OFFER list; when Sections are named they ride the same statement,
  // so the chunk size accounts for both lists staying inside the 100-bind limit.
  const offerChunk = sections === undefined ? BIND_CHUNK : Math.max(1, BIND_CHUNK - sections.length);
  for (let i = 0; i < offers.length; i += offerChunk) {
    const offerSlice = offers.slice(i, i + offerChunk);
    const offerMarks = offerSlice.map(() => "?").join(",");
    const sectionClause =
      sections === undefined ? "" : ` AND section_id IN (${sections.map(() => "?").join(",")})`;
    const res = await db
      .prepare(
        `SELECT ${columns} FROM leadgen_section_answer_maps
          WHERE offer_id IN (${offerMarks})${sectionClause}
            AND mapping_status = 'complete'
          ORDER BY section_id ASC, id ASC`,
      )
      .bind(...offerSlice, ...(sections ?? []))
      .all<AnswerMapRow>();
    for (const row of res.results ?? []) rows.push(row);
  }

  // Section order: the caller's when it named one (the lead's funnel order),
  // else section_id (the SQL order) — deterministic either way.
  const sectionRank = new Map<number, number>();
  if (sections !== undefined) sections.forEach((id, index) => sectionRank.set(id, index));
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ra = sectionRank.get(a.row.section_id) ?? a.row.section_id;
      const rb = sectionRank.get(b.row.section_id) ?? b.row.section_id;
      return ra === rb ? a.index - b.index : ra - rb;
    });

  for (const { row } of ranked) {
    let perOffer = out.get(row.offer_id);
    if (perOffer === undefined) {
      perOffer = {};
      out.set(row.offer_id, perOffer);
    }
    const list = perOffer[row.offer_payload_field_path] ?? [];
    list.push(answerMappingToBinding(rowToMapping(row)));
    perOffer[row.offer_payload_field_path] = list;
  }
  return out;
}
