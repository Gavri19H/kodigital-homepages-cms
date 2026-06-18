-- Migration 0019 (Rescue 4 / T4): prompt_presets variables_schema + output_rules.
--
-- The legacy reference preset stores a structured `variables_schema` (the
-- declared {{variable}} contract) and `output_rules` (post-generation
-- formatting / validation rules) in addition to the columns already declared
-- in 0001 (slug, prompt_template, category, variables), 0011 (text_model,
-- image_model) and 0014 (name, description, system/user prompt,
-- content_mapping). Both are added as TEXT DEFAULT '[]' so existing rows and
-- legacy callers that omit them read back an empty JSON array rather than NULL.
--
-- The operator image options (hero_image + above_subheadline_image prompt
-- boxes) persist inside the EXISTING content_mapping JSON under
-- content_mapping.image_prompts.{hero_image,above_subheadline_image} — that is
-- a value-shape convention on the 0014 content_mapping column, so no new
-- column is needed for them.

ALTER TABLE prompt_presets ADD COLUMN variables_schema TEXT DEFAULT '[]';
ALTER TABLE prompt_presets ADD COLUMN output_rules TEXT DEFAULT '[]';
