-- Migration 0014 (Phase 9 / T12): prompt_presets reference columns.
--
-- Rebuilds the AI Presets form to the legacy reference (MISSION W4). The
-- reference preset stores a display Name + Description, a split System/User
-- prompt, and a structured content-mapping ("Fields to Generate") in addition
-- to the slug/category/variables/model columns already declared in migration
-- 0001 (slug, prompt_template, category, variables) and 0011 (text_model,
-- image_model).
--
-- All five columns are added as nullable TEXT (NULL = not set): existing rows
-- and legacy API callers that only send slug/prompt_template keep working, and
-- no value literal is baked into the schema. The use-case `category` enum and
-- the structured `variables` payload continue to use the columns from 0001.

ALTER TABLE prompt_presets ADD COLUMN name TEXT;
ALTER TABLE prompt_presets ADD COLUMN description TEXT;
ALTER TABLE prompt_presets ADD COLUMN system_prompt_template TEXT;
ALTER TABLE prompt_presets ADD COLUMN user_prompt_template TEXT;
ALTER TABLE prompt_presets ADD COLUMN content_mapping TEXT;
