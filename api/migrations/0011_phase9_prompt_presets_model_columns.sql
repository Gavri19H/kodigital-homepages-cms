-- Migration 0011 (Phase 9 / T21 [E4]): prompt_presets model columns.
--
-- Adds per-preset AI model selection columns to prompt_presets (created in
-- migration 0001). Values are validated at the API layer against
-- SUPPORTED_TEXT_MODELS / SUPPORTED_IMAGE_MODELS in api/src/ai/models.ts —
-- the single source of truth for permitted model ids. Columns are nullable
-- TEXT: NULL means "use the registry default at call time"; no model id
-- literal is baked into the schema.

ALTER TABLE prompt_presets ADD COLUMN text_model TEXT;
ALTER TABLE prompt_presets ADD COLUMN image_model TEXT;
