-- 0052 — LeadGen rework M9: explicit Address field set.
--
-- Contract LEADGEN-REWORK-03 §5 M9 + §2 #6 + §6.10 + §11 #6. Pure-SQL content
-- migration over leadgen_sections.content_json (SQLite JSON1). Each top-level
-- AddressAutocompleteQuestion gains an explicit, behaviour-preserving
-- props.fields[] describing the four sub-fields it already collects today.
--
--   props.fields = [
--     {"field":"street","mode":"autofill","validation":"none"},
--     {"field":"city",  "mode":"autofill","validation":"none"},
--     {"field":"state", "mode":"autofill","validation":"none"},
--     {"field":"zip",   "mode":"autofill","validation":"zip5"}
--   ]
--
-- WHY these exact values (investigation of the CURRENT renderer/schema, per the
-- slice's requirement to mirror today EXACTLY, not to over-constrain):
--   * mode "autofill": today the composite fills street/city/state/zip from ONE
--     Maps autocomplete input (presets.ts renderAddressAutocompleteQuestion);
--     Maps-off/keyless already degrades to manual (the graceful no-op path), so
--     "autofill" is the behaviour-faithful mode.
--   * validation: zip -> "zip5" (the 5-digit rule that already lives in the ZIP
--     component, registry.ts:127); the other three "none" (no per-sub-field
--     format check exists today).
--   * NO per-field `required`: requiredness today is a SINGLE node-level flag
--     (node.required drives the one autocomplete input's `required` at
--     presets.ts; NO sub-field is ever individually validated for presence).
--     node.required is LEFT UNTOUCHED here so the current renderer behaviour is
--     byte-identical; stamping per-field required would over-constrain vs today.
--     How node.required composes with props.fields in the new renderer is a P2
--     concern.
--   * NO per-field `label`: address labels today are FIXED strings
--     ("Street"/"City"/"State"/"ZIP") hard-rendered ONLY in the studio-only,
--     aria-hidden composite PREVIEW (presets.ts) — never live, never authored/
--     stored. Per the slice, label is therefore left unset (absent => current
--     behaviour).
--
-- props.maps (incl. maps.fills) is UNTOUCHED, so the internal_field derivation
-- (maps.fills.<slot> else `<base>_<slot>`) and collectKnownAnswerFields are
-- byte-identical before/after: the field universe is preserved (the enumerator
-- reads maps.fills, not props.fields).
--
-- IDEMPOTENT: a node that already carries props.fields is skipped. A section with
-- no Address is not rewritten (WHERE excludes it) -> byte-identical.
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
        WHEN json_extract(comp.value, '$.type') = 'AddressAutocompleteQuestion'
             AND json_type(comp.value, '$.props.fields') IS NULL THEN
          json_set(
            comp.value,
            '$.props', json_patch(
              coalesce(comp.value -> '$.props', json_object()),
              json_object('fields', json('[{"field":"street","mode":"autofill","validation":"none"},{"field":"city","mode":"autofill","validation":"none"},{"field":"state","mode":"autofill","validation":"none"},{"field":"zip","mode":"autofill","validation":"zip5"}]'))
            )
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
    WHERE json_extract(c.value, '$.type') = 'AddressAutocompleteQuestion'
      AND json_type(c.value, '$.props.fields') IS NULL
  );
