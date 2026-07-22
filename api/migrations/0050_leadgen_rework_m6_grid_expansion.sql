-- 0050 — LeadGen rework M6: MultiQuestionGrid -> independent components.
--
-- Contract LEADGEN-REWORK-03 §5 M6 + §2 #1 (F-A) + §11 #1. Pure-SQL content
-- migration over leadgen_sections.content_json (SQLite JSON1). Each top-level
-- MultiQuestionGrid node expands IN PLACE to N components, ordered by
-- (component index, row index). The grid's own shared props (helper text,
-- answer format, its own choices set) die with the node — they are the
-- invented "main question" (§2 #1). leadgen_section_answer_maps is NOT touched:
-- the per-row question_id is the row's EXISTING projected id `<nodeQid>::<field>`
-- (config-dto.ts expandPublicComponents / multiQuestionRowQuestionId), so every
-- answer-map row, analytics key, and rule reference survives byte-identically.
--
-- Per-row mapping (each row -> one component):
--   type          = TwoButtonYesNo when the row's EFFECTIVE choices are exactly
--                   a {Yes,No}-labelled pair (label equality, order-independent),
--                   else ButtonAnswerGroup.
--   question_id   = <grid.question_id>::<row.internal_field>
--   internal_field= row.internal_field (byte-identical)
--   choices       = effective choices (row.choices override, else grid.choices)
--   props.label   = row.label (§6.3 — the per-question label the grid row carried)
--   props.defaultValue = row.default (only when the row has one; JSON type kept)
--   required      = true only when the row was required
--   conditional   = grid.conditional copied onto EVERY expanded component
-- No answer_type is stamped: TwoButtonYesNo produces "boolean" (an "enum"
-- answer_type would be an answer_type_mismatch), ButtonAnswerGroup defaults to
-- its catalog "enum" — so the shape validates under the current schema.
--
-- SCOPE: top-level components ($.components[*]). Nested-in-container grids (if
-- any ever exist) are surfaced by the migration report's detector, not rewritten
-- here (a grid never appears nested in current authoring). The field universe is
-- preserved regardless (collectKnownAnswerFields leaves an untouched node's
-- fields unchanged).
--
-- IDEMPOTENT: after this runs no MultiQuestionGrid remains, so the WHERE matches
-- nothing on a second application. A section with no grid is not rewritten at all
-- (WHERE excludes it), so untouched content stays byte-identical (no JSON1
-- re-serialisation).
--
-- CACHE INVALIDATION (adversarial review P2-3): content_html is a persisted
-- render CACHE of content_json (leadgen_sections.content_html TEXT — nullable,
-- no DEFAULT, migrations/0036_leadgen_core.sql:93). Investigation (exhaustive
-- grep of src/ for every leadgen-scoped read of `.content_html`): the live
-- shell (serve.ts), the studio's own preview endpoint, and the funnel-builder
-- preview ALL independently re-render fresh from content_json on every request
-- (three separate "the ONE shared renderer" comments) — no admin UI script
-- (ui-sections.ts, ui-section-studio.ts, ui-quotes.ts, quotes-handlers.ts) ever
-- reads `.content_html`; resolver.ts SELECTs it into ResolvedFunnelSection but
-- never consumes it after selection. So there is no live reader to mislead OR
-- to crash on NULL — but the column's own contract (sections-handlers.ts
-- renderContentHtml, asserted in leadgen-frame-serve.test.ts /
-- leadgen-section-overrides-save.test.ts) is "content_html mirrors
-- content_json"; leaving a rewritten row's old rendered markup in place would
-- violate that contract for exactly the rows this migration touches. NULL is
-- SET in the SAME statement (same WHERE scope, same idempotency: an
-- already-migrated row no longer matches the WHERE, so a re-apply never
-- re-touches it) — matching the nullable, no-DEFAULT schema and the
-- `content_html: string | null` type already declared on
-- LeadgenSectionRow/LeadgenSectionApi.

UPDATE leadgen_sections
SET content_json = json_set(
  content_json,
  '$.components',
  (
    SELECT json_group_array(json(out_node))
    FROM (
      SELECT
        CASE WHEN json_extract(comp.value, '$.type') = 'MultiQuestionGrid' THEN
          json_patch(
            json_patch(
              json_object(
                'type',
                CASE WHEN (
                    json_array_length(CASE WHEN json_type(r.value, '$.choices') = 'array' AND json_array_length(r.value, '$.choices') > 0 THEN r.value -> '$.choices' ELSE comp.value -> '$.choices' END) = 2
                    AND (SELECT count(*) FROM json_each(CASE WHEN json_type(r.value, '$.choices') = 'array' AND json_array_length(r.value, '$.choices') > 0 THEN r.value -> '$.choices' ELSE comp.value -> '$.choices' END) WHERE value ->> '$.label' = 'Yes') = 1
                    AND (SELECT count(*) FROM json_each(CASE WHEN json_type(r.value, '$.choices') = 'array' AND json_array_length(r.value, '$.choices') > 0 THEN r.value -> '$.choices' ELSE comp.value -> '$.choices' END) WHERE value ->> '$.label' = 'No') = 1
                  ) THEN 'TwoButtonYesNo' ELSE 'ButtonAnswerGroup' END,
                'question_id', (comp.value ->> '$.question_id') || '::' || (r.value ->> '$.internal_field'),
                'internal_field', r.value ->> '$.internal_field',
                'choices', json(CASE WHEN json_type(r.value, '$.choices') = 'array' AND json_array_length(r.value, '$.choices') > 0 THEN r.value -> '$.choices' ELSE comp.value -> '$.choices' END),
                'props', json_patch(
                  json_object('label', coalesce(r.value ->> '$.label', '')),
                  CASE WHEN json_type(r.value, '$.default') IS NOT NULL THEN json_object('defaultValue', json(r.value -> '$.default')) ELSE json_object() END
                )
              ),
              CASE WHEN json_extract(r.value, '$.required') = 1 THEN json_object('required', json('true')) ELSE json_object() END
            ),
            CASE WHEN json_type(comp.value, '$.conditional') IS NOT NULL THEN json_object('conditional', json(comp.value -> '$.conditional')) ELSE json_object() END
          )
        ELSE comp.value END AS out_node
      FROM json_each(leadgen_sections.content_json, '$.components') comp
      LEFT JOIN json_each(comp.value, '$.props.rows') r
        ON json_extract(comp.value, '$.type') = 'MultiQuestionGrid'
      ORDER BY comp.key, coalesce(r.key, 0)
    )
  )
),
  content_html = NULL
WHERE json_valid(content_json)
  AND EXISTS (
    SELECT 1 FROM json_each(content_json, '$.components') c
    WHERE json_extract(c.value, '$.type') = 'MultiQuestionGrid'
  );
