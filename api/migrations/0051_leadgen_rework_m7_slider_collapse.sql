-- 0051 — LeadGen rework M7: slider triplet -> one NumberRangeQuestion catalog.
--
-- Contract LEADGEN-REWORK-03 §5 M7 + §2 #7 + §6.8 + §11 #7. Pure-SQL content
-- migration over leadgen_sections.content_json (SQLite JSON1). Collapses the
-- three near-identical slider catalog entries onto NumberRangeQuestion and fixes
-- the Image9 failure class (the "$" toggle flipped node.type but never
-- answer_type -> answer_type_mismatch on save): answer_type is normalised to
-- "number" for every slider so type and answer_type can never disagree again.
--
-- Per-node transform (top-level components):
--   RangeQuestion         -> type NumberRangeQuestion, answer_type "number",
--                            props.slider_type "single", props.currency_affix false
--   CurrencyRangeQuestion -> type NumberRangeQuestion, answer_type "number",
--                            props.slider_type "single", props.currency_affix true
--   NumberRangeQuestion (no props.slider_type)
--                         -> answer_type "number", props.slider_type "single"
--                            (currency_affix left absent — "absent/false")
-- Currency is now render-cosmetic (props.currency_affix), never node.type; the
-- new slider_type domain {single,dual_range,stepper,from_to,radial} (§6.8) is a
-- P2 authoring concern — this migration only seeds the behaviour-preserving
-- "single". min/max/step and every other prop are preserved (json_patch merge).
--
-- Field universe unchanged: internal_field + question_id are untouched, so
-- collectKnownAnswerFields is identical before/after; the type change does not
-- add or remove any answer field.
--
-- IDEMPOTENT: a NumberRangeQuestion that already carries props.slider_type is not
-- re-matched; Range/CurrencyRange no longer exist after the first pass. A section
-- with no slider is not rewritten (WHERE excludes it) -> byte-identical.
--
-- CACHE INVALIDATION (adversarial review P2-3): see 0050's header for the full
-- investigation (content_html is nullable/no-DEFAULT, has NO live reader
-- anywhere in src/ — the live shell / studio preview / builder preview all
-- re-render fresh from content_json). Invalidated to NULL in the SAME
-- statement/WHERE scope for the rows this migration rewrites, so an
-- already-migrated row's stale rendered markup is never left behind.

UPDATE leadgen_sections
SET content_json = json_set(
  content_json,
  '$.components',
  (
    SELECT json_group_array(json(
      CASE
        WHEN json_extract(comp.value, '$.type') IN ('RangeQuestion', 'CurrencyRangeQuestion') THEN
          json_set(
            comp.value,
            '$.type', 'NumberRangeQuestion',
            '$.answer_type', 'number',
            '$.props', json_patch(
              coalesce(comp.value -> '$.props', json_object()),
              json_object(
                'slider_type', 'single',
                'currency_affix', json(CASE WHEN json_extract(comp.value, '$.type') = 'CurrencyRangeQuestion' THEN 'true' ELSE 'false' END)
              )
            )
          )
        WHEN json_extract(comp.value, '$.type') = 'NumberRangeQuestion'
             AND json_type(comp.value, '$.props.slider_type') IS NULL THEN
          json_set(
            comp.value,
            '$.answer_type', 'number',
            '$.props', json_patch(coalesce(comp.value -> '$.props', json_object()), json_object('slider_type', 'single'))
          )
        ELSE comp.value
      END
    ))
    FROM json_each(leadgen_sections.content_json, '$.components') comp
  )
),
  content_html = NULL
WHERE json_valid(content_json)
  AND EXISTS (
    SELECT 1 FROM json_each(content_json, '$.components') c
    WHERE json_extract(c.value, '$.type') IN ('RangeQuestion', 'CurrencyRangeQuestion')
       OR (json_extract(c.value, '$.type') = 'NumberRangeQuestion' AND json_type(c.value, '$.props.slider_type') IS NULL)
  );
