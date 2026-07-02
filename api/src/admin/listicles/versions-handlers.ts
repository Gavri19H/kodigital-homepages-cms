// Version save + pre-save page validation (contract §7.1 / §15.5 / §15.6 / §23).
//
// PUT /versions/:id is the builder's ATOMIC save: version fields + pages +
// candidates + rules commit in ONE env.DB.batch using a replace strategy
// (delete the version's pages — candidates/rules cascade — and reinsert from
// the payload, preserving provided public_ids and minting for new rows).
// Full §23 validation + the §15.5 rule-conflict guard run BEFORE any write.
//
// Running Versions are immutable (§15.6): editing one is refused with 409
// running_version_immutable — a meaningful edit forks a NEW Version, which
// arrives with the builder (Phase 5). On a PUBLISHED article (§30.7 case c)
// only BEHAVIORAL saves are refused (409 published_version_immutable);
// non-behavioral tweaks stay allowed as a content_version bump (case b).

import { mintPublicId, ulid } from "../../listicles/ids";
import {
  buildConflictPayload,
  conditionsHash,
  canonicalConditionsJson,
  detectRuleConflicts,
  type RuleGuardEntry,
  type RuleOverlapReport,
} from "../../listicles/rules";
import {
  validatePage,
  validateVersion,
  type FieldErrors,
  type PagePayload,
} from "../../listicles/validation";
import {
  type AdminContext,
  chunk,
  idSelector,
  placeholders,
  readJsonBody,
} from "./shared";
import type { VersionRowL } from "./articles-handlers";
import {
  loadPagesForVersions,
  structureFingerprint,
  type FingerprintPage,
  type StructurePage,
} from "./structure";

async function resolveVersionRow(db: D1Database, idParam: string): Promise<VersionRowL | null> {
  const selector = idSelector(idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM listicle_article_versions WHERE id = ? LIMIT 1"
      : "SELECT * FROM listicle_article_versions WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<VersionRowL>();
  return row ?? null;
}

interface SectionRefRow {
  id: number;
  public_id: string;
  section_name: string;
  status: string;
}

// Every candidate must reference a VALID section (§23) — and an archived
// Section is retired content (§5.3 soft-archive), so it cannot be (re)saved
// into a page.
async function loadSectionRefs(
  db: D1Database,
  sectionIds: readonly number[],
): Promise<Map<number, SectionRefRow>> {
  const map = new Map<number, SectionRefRow>();
  for (const ids of chunk([...new Set(sectionIds)])) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, section_name, status FROM listicle_sections
         WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<SectionRefRow>();
    for (const row of rows.results ?? []) map.set(row.id, row);
  }
  return map;
}

function verifySectionRefs(
  pages: PagePayload[],
  sections: Map<number, SectionRefRow>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const page of pages) {
    page.candidates.forEach((cand, index) => {
      const section = sections.get(cand.section_id);
      if (section === undefined) {
        errors[`page_${page.page_index}.candidates[${index}].section_id`] =
          `unknown section_id ${cand.section_id}`;
      } else if (section.status !== "active") {
        errors[`page_${page.page_index}.candidates[${index}].section_id`] =
          `section '${section.public_id}' is ${section.status}`;
      }
    });
  }
  return errors;
}

interface GuardOutcome {
  conflictFields: Record<string, RuleOverlapReport[]>;
  warnings: Array<RuleOverlapReport & { page_index: number }>;
}

// §15.5: equal-priority overlaps BLOCK; cross-priority overlaps are
// surfaced as non-blocking "can override" warnings.
function runConflictGuard(
  pages: PagePayload[],
  sections: Map<number, SectionRefRow>,
): GuardOutcome {
  const conflictFields: Record<string, RuleOverlapReport[]> = {};
  const warnings: Array<RuleOverlapReport & { page_index: number }> = [];
  for (const page of pages) {
    if (page.selection_mode !== "rule_based") continue;
    const entries: RuleGuardEntry[] = [];
    for (const cand of page.candidates) {
      if (cand.rule === null) continue;
      entries.push({
        candidate_key: sections.get(cand.section_id)?.section_name ?? cand.label,
        priority: cand.rule.priority,
        conditions: cand.rule.conditions,
      });
    }
    const { conflicts, warnings: pageWarnings } = detectRuleConflicts(entries);
    if (conflicts.length > 0) {
      const payload = buildConflictPayload(page.page_index, conflicts);
      Object.assign(conflictFields, payload.fields);
    }
    for (const warning of pageWarnings) {
      warnings.push({ ...warning, page_index: page.page_index });
    }
  }
  return { conflictFields, warnings };
}

// PUT /api/admin/listicles/versions/:id — atomic save of version fields +
// pages + candidates + rules (§7.1).
export async function putVersionHandler(c: AdminContext): Promise<Response> {
  const version = await resolveVersionRow(c.env.DB, c.req.param("id") ?? "");
  if (version === null) return c.json({ error: "Not Found" }, 404);

  // §15.6 immutability: a Version inside a RUNNING experiment cannot be
  // edited in place.
  if (version.experiment_id !== null) {
    const experiment = await c.env.DB.prepare(
      "SELECT status FROM listicle_article_experiments WHERE id = ? LIMIT 1",
    )
      .bind(version.experiment_id)
      .first<{ status: string }>();
    if (experiment?.status === "running") {
      return c.json(
        {
          error: "running_version_immutable",
          fields: {
            version:
              "editing a running Version forks a new Version (§15.6) — forking arrives with the builder (Phase 5)",
          },
        },
        409,
      );
    }
  }

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  // Full §23 validation FIRST — nothing is written unless everything passes.
  const validation = validateVersion(body);
  const errors: FieldErrors = { ...validation.errors };

  const sectionIds = validation.pages.flatMap((page) =>
    page.candidates.map((cand) => cand.section_id),
  );
  const sections = await loadSectionRefs(c.env.DB, sectionIds);
  Object.assign(errors, verifySectionRefs(validation.pages, sections));

  const guard = runConflictGuard(validation.pages, sections);
  if (Object.keys(guard.conflictFields).length > 0) {
    // The §15.5 payload shape — { error: "Rule conflict", fields:
    // { "page_<idx>.rules": [...] } } — merged with any other field errors.
    return c.json(
      {
        error: "Rule conflict",
        fields: { ...errors, ...guard.conflictFields },
        warnings: guard.warnings,
      },
      400,
    );
  }
  if (Object.keys(errors).length > 0 || validation.fields === null) {
    return c.json({ error: "Validation failed", fields: errors }, 400);
  }
  const fields = validation.fields;

  // Current tree: change detection + ab_test_id / rule_set_id continuity.
  const currentPagesByVersion = await loadPagesForVersions(c.env.DB, [version.id]);
  const currentPages: StructurePage[] = currentPagesByVersion.get(version.id) ?? [];
  const currentByPublicId = new Map(currentPages.map((page) => [page.public_id, page]));

  // Pre-compute rule hashes + selection-group ids, and build the new tree's
  // fingerprint alongside.
  interface PreparedRule {
    public_id: string;
    priority: number;
    conditions_json: string;
    conditions_hash: string;
  }
  interface PreparedCandidate {
    public_id: string;
    section_id: number;
    label: string;
    traffic_allocation: number | null;
    is_fallback: number;
    rule: PreparedRule | null;
  }
  interface PreparedPage {
    public_id: string;
    page_index: number;
    selection_mode: string;
    ab_test_id: string | null;
    rule_set_id: string | null;
    candidates: PreparedCandidate[];
  }

  const preparedPages: PreparedPage[] = [];
  for (const page of validation.pages) {
    const existingPage =
      page.public_id !== null ? currentByPublicId.get(page.public_id) : undefined;
    // §23 "stable ab_test_id": keep the payload's id; else inherit the
    // surviving page's; only mint for a genuinely new A/B group. Same for
    // rule_set_id (== page_rule_set_id).
    const abTestId =
      page.selection_mode === "ab_test"
        ? page.ab_test_id ?? existingPage?.ab_test_id ?? `ab_${ulid()}`
        : null;
    const ruleSetId =
      page.selection_mode === "rule_based"
        ? page.rule_set_id ?? existingPage?.rule_set_id ?? `rs_${ulid()}`
        : null;

    const candidates: PreparedCandidate[] = [];
    for (const cand of page.candidates) {
      let rule: PreparedRule | null = null;
      if (cand.rule !== null) {
        rule = {
          public_id: cand.rule.public_id ?? mintPublicId("rule"),
          priority: cand.rule.priority,
          conditions_json: canonicalConditionsJson(cand.rule.conditions),
          conditions_hash: await conditionsHash(cand.rule.conditions),
        };
      }
      candidates.push({
        public_id: cand.public_id ?? mintPublicId("candidate"),
        section_id: cand.section_id,
        label: cand.label,
        traffic_allocation: cand.traffic_allocation,
        is_fallback: cand.is_fallback ? 1 : 0,
        rule,
      });
    }
    preparedPages.push({
      public_id: page.public_id ?? mintPublicId("page"),
      page_index: page.page_index,
      selection_mode: page.selection_mode,
      ab_test_id: abTestId,
      rule_set_id: ruleSetId,
      candidates,
    });
  }

  // content_version bumps ON CHANGE (§15.6/§30.7: the bump is a new cache
  // identity + article_version_revision). A byte-identical re-save keeps it.
  const fieldsChanged =
    fields.headline !== version.headline ||
    fields.intro_paragraph !== version.intro_paragraph ||
    fields.hero_media_id !== version.hero_media_id ||
    fields.hero_media_url !== version.hero_media_url ||
    fields.layout_style_id !== version.layout_style_id ||
    (fields.ai_settings_json ?? null) !== (version.ai_settings_json ?? null);
  const treeChanged =
    structureFingerprint(currentPages) !==
    structureFingerprint(preparedPages as FingerprintPage[]);

  // §15.6/§30.7 case (c): a BEHAVIORAL change (the same fingerprint that
  // drives the content_version bump) to a published article's Version must
  // fork a NEW Version (new lander_v) — forking arrives with the builder
  // (Phase 5); interim: set the article back to draft via PATCH, edit,
  // re-publish. Non-behavioral saves fall through (case b: content_version
  // bump, same lander_v). The running-experiment 409 above stays the
  // strictest guard — it blocks ALL edits.
  if (treeChanged) {
    const article = await c.env.DB.prepare(
      "SELECT status FROM listicle_articles WHERE id = ? LIMIT 1",
    )
      .bind(version.article_id)
      .first<{ status: string }>();
    if (article?.status === "published") {
      return c.json(
        {
          error: "published_version_immutable",
          fields: {
            version:
              "meaningful edits to a published Version must fork a new Version (§15.6 case c) — forking arrives with the builder (Phase 5); interim: set the article back to draft via PATCH, edit, then re-publish",
          },
        },
        409,
      );
    }
  }
  const contentVersion = version.content_version + (fieldsChanged || treeChanged ? 1 : 0);

  // ATOMIC replace: update fields, drop the old page tree (candidates +
  // rules cascade), reinsert the new tree. Later statements attach through
  // scalar subselects on the unique public ids inserted earlier in the SAME
  // batch — D1 batches are transactional, so a failing statement rolls back
  // every row.
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE listicle_article_versions
       SET headline = ?, intro_paragraph = ?, hero_media_id = ?, hero_media_url = ?,
           layout_style_id = ?, ai_settings_json = ?, content_version = ?
       WHERE id = ?`,
    ).bind(
      fields.headline,
      fields.intro_paragraph,
      fields.hero_media_id,
      fields.hero_media_url,
      fields.layout_style_id,
      fields.ai_settings_json,
      contentVersion,
      version.id,
    ),
    c.env.DB.prepare("DELETE FROM listicle_pages WHERE article_version_id = ?").bind(version.id),
  ];
  for (const page of preparedPages) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO listicle_pages
           (public_id, article_version_id, page_index, selection_mode, ab_test_id, rule_set_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        page.public_id,
        version.id,
        page.page_index,
        page.selection_mode,
        page.ab_test_id,
        page.rule_set_id,
      ),
    );
    for (const cand of page.candidates) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO listicle_page_section_candidates
             (public_id, page_id, section_id, label, traffic_allocation, is_fallback)
           VALUES (?, (SELECT id FROM listicle_pages WHERE public_id = ?), ?, ?, ?, ?)`,
        ).bind(
          cand.public_id,
          page.public_id,
          cand.section_id,
          cand.label,
          cand.traffic_allocation,
          cand.is_fallback,
        ),
      );
      if (cand.rule !== null) {
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO listicle_page_rules
               (public_id, page_id, candidate_id, priority, conditions_json, conditions_hash)
             VALUES (?, (SELECT id FROM listicle_pages WHERE public_id = ?),
                     (SELECT id FROM listicle_page_section_candidates WHERE public_id = ?),
                     ?, ?, ?)`,
          ).bind(
            cand.rule.public_id,
            page.public_id,
            cand.public_id,
            cand.rule.priority,
            cand.rule.conditions_json,
            cand.rule.conditions_hash,
          ),
        );
      }
    }
  }

  try {
    await c.env.DB.batch(statements);
  } catch (err) {
    const message = (err as Error).message ?? "";
    // The batch rolled back — the version's previous tree is intact.
    if (/UNIQUE|FOREIGN KEY/i.test(message)) {
      return c.json(
        { error: "Validation failed", fields: { pages: `version save rejected: ${message}` } },
        400,
      );
    }
    return c.json({ error: `Version save failed: ${message}` }, 500);
  }

  const savedVersion = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE id = ? LIMIT 1",
  )
    .bind(version.id)
    .first<VersionRowL>();
  const savedPages = (await loadPagesForVersions(c.env.DB, [version.id])).get(version.id) ?? [];
  return c.json({ version: savedVersion, pages: savedPages, warnings: guard.warnings });
}

interface PageRowL {
  id: number;
  public_id: string;
  article_version_id: number;
  page_index: number;
  selection_mode: string;
  ab_test_id: string | null;
  rule_set_id: string | null;
}

// POST /api/admin/listicles/pages/:id/validate — run the §15.5 rule-conflict
// check for a rule_based page payload WITHOUT writing (§7.1 "conflict matrix
// / 400 report"). Blocking conflicts → 400 with the exact §15.5 payload;
// clean → 200 with the cross-priority warnings.
export async function validatePageHandler(c: AdminContext): Promise<Response> {
  const selector = idSelector(c.req.param("id") ?? "");
  if (selector === null) return c.json({ error: "Not Found" }, 404);
  const sql =
    selector.column === "id"
      ? "SELECT * FROM listicle_pages WHERE id = ? LIMIT 1"
      : "SELECT * FROM listicle_pages WHERE public_id = ? LIMIT 1";
  const page = await c.env.DB.prepare(sql).bind(selector.value).first<PageRowL>();
  if (!page) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const result = validatePage(body, page.page_index);
  if (result.value === null) {
    return c.json({ error: "Validation failed", fields: result.errors }, 400);
  }

  const sectionIds = result.value.candidates.map((cand) => cand.section_id);
  const sections = await loadSectionRefs(c.env.DB, sectionIds);
  const refErrors = verifySectionRefs([result.value], sections);
  if (Object.keys(refErrors).length > 0) {
    return c.json({ error: "Validation failed", fields: refErrors }, 400);
  }

  const guard = runConflictGuard([result.value], sections);
  const conflictRows = guard.conflictFields[`page_${result.value.page_index}.rules`] ?? [];
  if (conflictRows.length > 0) {
    return c.json(
      {
        ...buildConflictPayload(result.value.page_index, conflictRows),
        warnings: guard.warnings,
      },
      400,
    );
  }
  return c.json({
    ok: true,
    page_index: result.value.page_index,
    conflicts: [],
    warnings: guard.warnings,
  });
}
