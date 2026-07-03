// POST /api/admin/listicles/versions/:id/fork — §15.6 case c.
//
// "Running/published Versions are immutable: a meaningful content change
// while running FORKS a new Version (new `ver_` ⇒ new `lander_v`), so a live
// arm's data never mixes across edits."
//
// The fork CLONES the source Version:
//   * new `ver_` public_id (== the new lander_v), content_version RESET to 1
//     (a fresh revision period for a fresh lander_v),
//   * same article; copies headline / intro / hero / layout / ai_settings /
//     the §30.2 byline_json,
//   * deep-copies the page tree — pages, candidates, rules — minting new
//     pg_/cand_/rule_ public ids (public_id is UNIQUE) while copying
//     page_index / selection_mode / labels / allocations / fallbacks /
//     priorities / conditions_json / conditions_hash verbatim.
//     AUTHORED (declared): `ab_test_id` / `rule_set_id` are copied AS-IS —
//     they identify the page-level selection GROUP (§15.7 page_ab_test_id /
//     page_rule_set_id), and the same continuity rule that PUT /versions/:id
//     applies ("stable ab_test_id", §23) keeps client-side sticky assignment
//     stable across a fork.
//   * experiment membership: if the source belongs to an experiment, the fork
//     joins it as a new variant ONLY when the caller EXPLICITLY requests it
//     (body.join_experiment === true — §15.6: a live arm never silently
//     gains siblings) — and ONLY while that experiment is a DRAFT. Joining a
//     RUNNING experiment would violate §15.8/§5.2 experiment validity: its
//     Σ==100 is live config (a joined allocation breaks the sum; a 0% join is
//     a permanently dead arm — running allocations are not editable and
//     /start is draft-only), and a STOPPED experiment is kept history (§5.3).
//     A non-draft join → 409 experiment_not_joinable. Otherwise the fork
//     lands as a draft-standalone Version (experiment_id NULL, is_control 0,
//     allocation 0). Draft joins stay Σ-validated at /experiments/:id/start
//     over the merged arm set.
//
// Everything commits in ONE env.DB.batch — the source Version is never
// touched (asserted by test).

import { mintPublicId } from "../../listicles/ids";
import type { AdminContext } from "./shared";
import { readJsonBody } from "./shared";
import type { VersionRowL } from "./articles-handlers";
import { resolveVersionRow } from "./versions-handlers";
import { loadPagesForVersions } from "./structure";

interface ForkBody {
  join_experiment: boolean;
  variant_label: string | null;
  traffic_allocation: number;
}

function parseForkBody(raw: Record<string, unknown>): ForkBody | { error: string; field: string } {
  const join_experiment = raw.join_experiment === true;
  let variant_label: string | null = null;
  if (raw.variant_label !== undefined && raw.variant_label !== null) {
    if (typeof raw.variant_label !== "string" || raw.variant_label.trim() === "") {
      return { error: "variant_label must be a non-empty string", field: "variant_label" };
    }
    variant_label = raw.variant_label.trim();
  }
  let traffic_allocation = 0;
  if (raw.traffic_allocation !== undefined && raw.traffic_allocation !== null) {
    const v = raw.traffic_allocation;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100) {
      return { error: "traffic_allocation must be an integer 0-100", field: "traffic_allocation" };
    }
    traffic_allocation = v;
  }
  return { join_experiment, variant_label, traffic_allocation };
}

// Next free single-letter variant label (A, B, C, …) after the article's
// existing labels; falls back to V<n> past Z.
function nextVariantLabel(existing: readonly string[]): string {
  const taken = new Set(existing.map((l) => l.trim().toUpperCase()));
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!taken.has(letter)) return letter;
  }
  return `V${existing.length + 1}`;
}

export async function forkVersionHandler(c: AdminContext): Promise<Response> {
  const source = await resolveVersionRow(c.env.DB, c.req.param("id") ?? "");
  if (source === null) return c.json({ error: "Not Found" }, 404);

  const raw = (await readJsonBody(c)) ?? {};
  const body = parseForkBody(raw);
  if ("error" in body) {
    return c.json({ error: "Validation failed", fields: { [body.field]: body.error } }, 400);
  }

  // Explicit-join rule (§15.6): joining is only meaningful when the source
  // HAS an experiment; asking to join without one is a caller mistake worth
  // surfacing rather than silently ignoring.
  if (body.join_experiment && source.experiment_id === null) {
    return c.json(
      {
        error: "Validation failed",
        fields: { join_experiment: "the source Version does not belong to an experiment" },
      },
      400,
    );
  }
  // §15.8/§5.2 experiment validity: a fork may join ONLY a DRAFT experiment.
  // Running: Σ==100 is live config and allocations are immutable while
  // running (/start is draft-only) — a join is either a Σ violation or a
  // permanently dead 0% arm. Stopped: history (§5.3).
  if (body.join_experiment && source.experiment_id !== null) {
    const experiment = await c.env.DB.prepare(
      "SELECT public_id, status FROM listicle_article_experiments WHERE id = ? LIMIT 1",
    )
      .bind(source.experiment_id)
      .first<{ public_id: string; status: string }>();
    if (!experiment || experiment.status !== "draft") {
      return c.json(
        {
          error: "experiment_not_joinable",
          fields: {
            join_experiment: `experiment '${experiment?.public_id ?? String(source.experiment_id)}' is ${experiment?.status ?? "missing"} — a fork can join only a DRAFT experiment (§15.8: a running experiment's Σ=100 and arm set are locked; a stopped one is history). Stop the experiment and compose a new draft, or fork standalone`,
          },
        },
        409,
      );
    }
  }
  const experimentId = body.join_experiment ? source.experiment_id : null;

  const labels = await c.env.DB.prepare(
    "SELECT variant_label FROM listicle_article_versions WHERE article_id = ?",
  )
    .bind(source.article_id)
    .all<{ variant_label: string }>();
  const existingLabels = (labels.results ?? []).map((r) => r.variant_label);
  // FIX-3: an EXPLICIT variant_label colliding with an existing arm's label
  // is a caller error (labels identify arms in analytics/UI); auto-advance
  // stays for omitted labels.
  if (
    body.variant_label !== null &&
    existingLabels.some((l) => l.trim().toUpperCase() === (body.variant_label as string).toUpperCase())
  ) {
    return c.json(
      {
        error: "Validation failed",
        fields: {
          variant_label: `variant_label '${body.variant_label}' is already used by another Version of this article`,
        },
      },
      400,
    );
  }
  const label = body.variant_label ?? nextVariantLabel(existingLabels);

  const sourcePages = (await loadPagesForVersions(c.env.DB, [source.id])).get(source.id) ?? [];

  const newVersionPublicId = mintPublicId("version"); // == the fork's lander_v
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO listicle_article_versions
         (public_id, article_id, experiment_id, variant_label, is_control, traffic_allocation,
          headline, intro_paragraph, hero_media_id, hero_media_url,
          layout_style_id, byline_json, ai_settings_json, content_version, status)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active')`,
    ).bind(
      newVersionPublicId,
      source.article_id,
      experimentId,
      label,
      body.traffic_allocation,
      source.headline,
      source.intro_paragraph,
      source.hero_media_id,
      source.hero_media_url,
      source.layout_style_id,
      source.byline_json,
      source.ai_settings_json,
    ),
  ];

  // Deep-copy the tree. Later statements attach through scalar subselects on
  // the unique public ids inserted earlier in the SAME batch (the exact
  // pattern PUT /versions/:id uses) — D1 batches are transactional, so a
  // failure anywhere leaves neither a partial fork nor a touched source.
  for (const page of sourcePages) {
    const pagePublicId = mintPublicId("page");
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO listicle_pages
           (public_id, article_version_id, page_index, selection_mode, ab_test_id, rule_set_id)
         VALUES (?, (SELECT id FROM listicle_article_versions WHERE public_id = ?), ?, ?, ?, ?)`,
      ).bind(
        pagePublicId,
        newVersionPublicId,
        page.page_index,
        page.selection_mode,
        page.ab_test_id,
        page.rule_set_id,
      ),
    );
    for (const cand of page.candidates) {
      const candPublicId = mintPublicId("candidate");
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO listicle_page_section_candidates
             (public_id, page_id, section_id, label, traffic_allocation, is_fallback)
           VALUES (?, (SELECT id FROM listicle_pages WHERE public_id = ?), ?, ?, ?, ?)`,
        ).bind(
          candPublicId,
          pagePublicId,
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
            mintPublicId("rule"),
            pagePublicId,
            candPublicId,
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
    // The batch rolled back — nothing was written.
    return c.json({ error: `Fork failed: ${message}` }, 500);
  }

  const forked = await c.env.DB.prepare(
    "SELECT * FROM listicle_article_versions WHERE public_id = ? LIMIT 1",
  )
    .bind(newVersionPublicId)
    .first<VersionRowL>();
  if (!forked) return c.json({ error: "Fork failed" }, 500);
  const pages = (await loadPagesForVersions(c.env.DB, [forked.id])).get(forked.id) ?? [];
  return c.json(
    {
      version: forked,
      pages,
      source_public_id: source.public_id,
      joined_experiment: experimentId !== null,
    },
    201,
  );
}
