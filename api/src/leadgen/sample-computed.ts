// OWNER 2026-09-28 — "The admin payload preview shows a calculated choice's saved
// value, not its date (live request is correct)". The live auction gets each
// calculated choice's DATE from normalizeAnswers(section content, answers)
// .computed (engine.ts). The admin previews (a Section's payload preview, an
// Offer's Test tab, the auction simulate) start from sample answers with no
// section in hand, so they sent the saved value ("2") where production sends
// the date. This derives the same `computed` map for sample answers from every
// Section that maps the given Offers — the same Sections the previews already
// read their answer bindings from (readAnswerBindings: complete mappings only,
// Section order). Two Sections that calculate the same answer differently: the
// FIRST in that order wins, matching which Section's binding the payload uses.
import type { D1Database } from "@cloudflare/workers-types";
import { normalizeAnswers, type LeadgenRawAnswers } from "./answers";
import type { LeadgenSectionContent } from "../public/leadgen/components/content-schema";

function parseContent(contentJson: string | null): LeadgenSectionContent {
  if (typeof contentJson !== "string" || contentJson === "") return { components: [] } as unknown as LeadgenSectionContent;
  try {
    const parsed = JSON.parse(contentJson) as { components?: unknown };
    return { components: Array.isArray(parsed?.components) ? parsed.components : [] } as unknown as LeadgenSectionContent;
  } catch {
    return { components: [] } as unknown as LeadgenSectionContent;
  }
}

export async function sampleAnswerComputed(
  db: D1Database,
  offerIds: readonly number[],
  sampleAnswers: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ids = [...new Set(offerIds.filter((id) => Number.isInteger(id)))];
  if (ids.length === 0 || Object.keys(sampleAnswers).length === 0) return out;
  // 100-binding D1 limit: chunk the IN list (80 per statement).
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const rows = await db
      .prepare(
        `SELECT DISTINCT s.id, s.content_json FROM leadgen_sections s
           JOIN leadgen_section_answer_maps m ON m.section_id = s.id
          WHERE m.offer_id IN (${slice.map(() => "?").join(",")})
            AND m.mapping_status = 'complete'
          ORDER BY s.id ASC`,
      )
      .bind(...slice)
      .all<{ id: number; content_json: string | null }>();
    for (const row of rows.results ?? []) {
      const { computed } = normalizeAnswers(parseContent(row.content_json), sampleAnswers as LeadgenRawAnswers);
      for (const [field, value] of Object.entries(computed)) {
        if (!Object.prototype.hasOwnProperty.call(out, field)) out[field] = value;
      }
    }
  }
  return out;
}

// Review 3 (F7): per Offer, each calculated answer comes from the Section whose
// COMPLETE mapping sends that answer to that Offer (the lowest Section id when
// several do — readAnswerBindings' order). A Section that maps the Offer only
// through other answers no longer decides this answer's date.
export async function sampleAnswerComputedByOffer(
  db: D1Database,
  offerIds: readonly number[],
  sampleAnswers: Readonly<Record<string, unknown>>,
): Promise<Map<number, Record<string, string>>> {
  const out = new Map<number, Record<string, string>>();
  const ids = [...new Set(offerIds.filter((id) => Number.isInteger(id)))];
  for (const id of ids) out.set(id, {});
  if (ids.length === 0 || Object.keys(sampleAnswers).length === 0) return out;
  const maps: Array<{ offer_id: number; internal_field: string; section_id: number }> = [];
  for (let i = 0; i < ids.length; i += 80) {
    const slice = ids.slice(i, i + 80);
    const rows = await db
      .prepare(
        `SELECT offer_id, internal_field, section_id FROM leadgen_section_answer_maps
          WHERE offer_id IN (${slice.map(() => "?").join(",")}) AND mapping_status = 'complete'
          ORDER BY section_id ASC, id ASC`,
      )
      .bind(...slice)
      .all<{ offer_id: number; internal_field: string; section_id: number }>();
    for (const row of rows.results ?? []) maps.push(row);
  }
  const sectionIds = [...new Set(maps.map((m) => m.section_id))];
  const computedBySection = new Map<number, Record<string, string>>();
  for (let i = 0; i < sectionIds.length; i += 80) {
    const slice = sectionIds.slice(i, i + 80);
    const rows = await db
      .prepare(`SELECT id, content_json FROM leadgen_sections WHERE id IN (${slice.map(() => "?").join(",")})`)
      .bind(...slice)
      .all<{ id: number; content_json: string | null }>();
    for (const row of rows.results ?? []) {
      computedBySection.set(row.id, normalizeAnswers(parseContent(row.content_json), sampleAnswers as LeadgenRawAnswers).computed);
    }
  }
  for (const m of maps) {
    const perOffer = out.get(m.offer_id);
    const value = computedBySection.get(m.section_id)?.[m.internal_field];
    if (perOffer === undefined || value === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(perOffer, m.internal_field)) perOffer[m.internal_field] = value;
  }
  return out;
}
