// Version → Pages → Candidates (+ rules, + section names) loader.
//
// One loader feeds three consumers: GET /articles/:id/structure, the publish
// validation pass (§23 re-run over stored state), and PUT /versions/:id's
// change detection (content_version bumps only on real change — §15.6).

import { chunk, placeholders } from "./shared";

export interface StructureRule {
  id: number;
  public_id: string;
  priority: number;
  conditions_json: string;
  conditions_hash: string;
}

export interface StructureCandidate {
  id: number;
  public_id: string;
  page_id: number;
  section_id: number;
  section_public_id: string;
  section_name: string;
  label: string;
  traffic_allocation: number | null;
  is_fallback: number;
  rule: StructureRule | null;
}

export interface StructurePage {
  id: number;
  public_id: string;
  article_version_id: number;
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  rule_set_id: string | null;
  candidates: StructureCandidate[];
}

interface PageRow {
  id: number;
  public_id: string;
  article_version_id: number;
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  rule_set_id: string | null;
}

interface CandidateRow {
  id: number;
  public_id: string;
  page_id: number;
  section_id: number;
  label: string;
  traffic_allocation: number | null;
  is_fallback: number;
  section_public_id: string;
  section_name: string;
}

interface RuleRow {
  id: number;
  public_id: string;
  page_id: number;
  candidate_id: number;
  priority: number;
  conditions_json: string;
  conditions_hash: string;
}

// Load the full page tree for a set of versions. IN(?) lists are chunked
// ≤ 80 binds (D1 100-binding limit).
export async function loadPagesForVersions(
  db: D1Database,
  versionIds: readonly number[],
): Promise<Map<number, StructurePage[]>> {
  const byVersion = new Map<number, StructurePage[]>();
  if (versionIds.length === 0) return byVersion;

  const pages: PageRow[] = [];
  for (const ids of chunk(versionIds)) {
    const rows = await db
      .prepare(
        `SELECT id, public_id, article_version_id, page_index, selection_mode, ab_test_id, rule_set_id
         FROM listicle_pages WHERE article_version_id IN (${placeholders(ids.length)})
         ORDER BY page_index ASC`,
      )
      .bind(...ids)
      .all<PageRow>();
    pages.push(...(rows.results ?? []));
  }

  const pageIds = pages.map((p) => p.id);
  const candidates: CandidateRow[] = [];
  const rules: RuleRow[] = [];
  for (const ids of chunk(pageIds)) {
    if (ids.length === 0) continue;
    const candRows = await db
      .prepare(
        `SELECT c.id, c.public_id, c.page_id, c.section_id, c.label,
                c.traffic_allocation, c.is_fallback,
                s.public_id AS section_public_id, s.section_name
         FROM listicle_page_section_candidates c
         JOIN listicle_sections s ON s.id = c.section_id
         WHERE c.page_id IN (${placeholders(ids.length)})
         ORDER BY c.id ASC`,
      )
      .bind(...ids)
      .all<CandidateRow>();
    candidates.push(...(candRows.results ?? []));
    const ruleRows = await db
      .prepare(
        `SELECT id, public_id, page_id, candidate_id, priority, conditions_json, conditions_hash
         FROM listicle_page_rules WHERE page_id IN (${placeholders(ids.length)})
         ORDER BY priority ASC, id ASC`,
      )
      .bind(...ids)
      .all<RuleRow>();
    rules.push(...(ruleRows.results ?? []));
  }

  const ruleByCandidate = new Map<number, StructureRule>();
  for (const rule of rules) {
    ruleByCandidate.set(rule.candidate_id, {
      id: rule.id,
      public_id: rule.public_id,
      priority: rule.priority,
      conditions_json: rule.conditions_json,
      conditions_hash: rule.conditions_hash,
    });
  }

  const candidatesByPage = new Map<number, StructureCandidate[]>();
  for (const cand of candidates) {
    const entry: StructureCandidate = {
      id: cand.id,
      public_id: cand.public_id,
      page_id: cand.page_id,
      section_id: cand.section_id,
      section_public_id: cand.section_public_id,
      section_name: cand.section_name,
      label: cand.label,
      traffic_allocation: cand.traffic_allocation,
      is_fallback: cand.is_fallback,
      rule: ruleByCandidate.get(cand.id) ?? null,
    };
    const bucket = candidatesByPage.get(cand.page_id);
    if (bucket === undefined) candidatesByPage.set(cand.page_id, [entry]);
    else bucket.push(entry);
  }

  for (const page of pages) {
    const entry: StructurePage = {
      id: page.id,
      public_id: page.public_id,
      article_version_id: page.article_version_id,
      page_index: page.page_index,
      selection_mode: page.selection_mode,
      ab_test_id: page.ab_test_id,
      rule_set_id: page.rule_set_id,
      candidates: candidatesByPage.get(page.id) ?? [],
    };
    const bucket = byVersion.get(page.article_version_id);
    if (bucket === undefined) byVersion.set(page.article_version_id, [entry]);
    else bucket.push(entry);
  }
  return byVersion;
}

// Minimal structural shape the fingerprint needs — StructurePage satisfies it,
// and PUT /versions/:id builds it straight from the incoming payload too.
export interface FingerprintPage {
  page_index: number;
  selection_mode: string;
  candidates: Array<{
    section_id: number;
    label: string;
    traffic_allocation: number | null;
    is_fallback: number;
    rule: { priority: number; conditions_hash: string } | null;
  }>;
}

// Canonical fingerprint of a version's page tree — the change-detection input
// for the PUT /versions/:id content_version bump. Only BEHAVIORAL identity
// participates (indexes, modes, sections, allocations, fallbacks, rule
// priority/conditions) — public ids and row ids do not.
export function structureFingerprint(pages: FingerprintPage[]): string {
  const canonical = [...pages]
    .sort((a, b) => a.page_index - b.page_index)
    .map((page) => ({
      i: page.page_index,
      m: page.selection_mode,
      c: [...page.candidates]
        .map((cand) => ({
          s: cand.section_id,
          l: cand.label,
          t: cand.traffic_allocation ?? null,
          f: cand.is_fallback === 1 ? 1 : 0,
          r: cand.rule === null ? null : { p: cand.rule.priority, h: cand.rule.conditions_hash },
        }))
        .sort((a, b) => (a.s === b.s ? a.l.localeCompare(b.l) : a.s - b.s)),
    }));
  return JSON.stringify(canonical);
}
