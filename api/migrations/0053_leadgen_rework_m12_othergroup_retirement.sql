-- 0053 — LeadGen rework M12: OtherGroupSelector + choiceDisplay retirement.
--
-- Contract LEADGEN-REWORK-03 §5 M12 + §2 #8 (F-B) + §10 + §11 #8. Pure-SQL
-- content migration over leadgen_sections.content_json (SQLite JSON1). Two grid-
-- wide sweeps, applied to every top-level component:
--
--   1. type OtherGroupSelector -> ButtonAnswerGroup. The node's `choices` array
--      ALREADY holds every choice (choiceDisplay.mainValues only PARTITIONED the
--      existing list into main/secondary — presets.ts splitChoicesForOtherGroup);
--      so retiring the type leaves ALL choices as ordinary visible base choices.
--      OtherGroupSelector and ButtonAnswerGroup have identical required fields
--      ({internal_field, choices}) and both produce "enum", so the flip is a
--      valid, shape-preserving rename.
--   2. Strip the top-level `choiceDisplay` prop from EVERY node of ANY type
--      (buttons and cards carried it too). json_remove is a no-op when the key is
--      absent. The old semantic re-bucketed existing choices; the NEW-model
--      "other" is a separately-authored list and is deliberately NOT auto-enabled
--      here — the migration report names every affected section so the owner can
--      re-author an Other list where wanted.
--
-- Field universe unchanged: internal_field + question_id are untouched (only the
-- type name changes and choiceDisplay is dropped), so collectKnownAnswerFields is
-- identical before/after.
--
-- IDEMPOTENT: after this runs no OtherGroupSelector and no choiceDisplay remain,
-- so the WHERE matches nothing on a second application. A section carrying
-- neither is not rewritten (WHERE excludes it) -> byte-identical.

UPDATE leadgen_sections
SET content_json = json_set(
  content_json,
  '$.components',
  (
    SELECT json_group_array(json(
      json_remove(
        CASE
          WHEN json_extract(comp.value, '$.type') = 'OtherGroupSelector'
            THEN json_set(comp.value, '$.type', 'ButtonAnswerGroup')
          ELSE comp.value
        END,
        '$.choiceDisplay'
      )
    ))
    FROM json_each(leadgen_sections.content_json, '$.components') comp
  )
)
WHERE json_valid(content_json)
  AND EXISTS (
    SELECT 1 FROM json_each(content_json, '$.components') c
    WHERE json_extract(c.value, '$.type') = 'OtherGroupSelector'
       OR json_type(c.value, '$.choiceDisplay') IS NOT NULL
  );
