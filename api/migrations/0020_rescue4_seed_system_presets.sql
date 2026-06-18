-- Migration 0020 (Rescue 4 / T5): seed editable is_system prompt presets for
-- every automatic provisioning task.
--
-- T5-AC1: site provisioning generates each automatic asset by resolving a
-- preset by task key (the same lookup shape as resolveCategoryPreset —
-- ORDER BY is_system DESC). For every task key to resolve on a fresh site,
-- this migration seeds one is_system=1 default preset per provisioning task
-- key:
--   starter-articles / tagline / site-description / logo / hero-image /
--   feature-image.
-- The task key is stored in `category` (the resolvable lookup key) and the
-- globally-unique `slug` is system-<task-key>.
--
-- T5-AC2 invariants:
--   * is_system = 1 (platform defaults, not operator presets) and is_active = 1.
--   * INSERT OR IGNORE on the slug UNIQUE index (migration 0001) makes the seed
--     idempotent: re-applying inserts nothing new and never duplicates a row.
--   * Each preset carries a real, EDITABLE prompt — the flat prompt_template
--     plus the reference System/User split (migration 0014) — with the
--     {{vertical}}/{{brand_name}}/{{audience}}/{{title}} interpolation tokens
--     the resolver substitutes at generation time. Operators edit these rows
--     through the admin AI Presets UI exactly like any other preset.
--   * text_model is the single SUPPORTED_TEXT_MODELS id (gpt-5.5); image_model
--     is the single SUPPORTED_IMAGE_MODELS id (gpt-image-2) for image tasks and
--     NULL for text-only tasks. No unsupported model id is baked in.
--   * variables_schema / output_rules are left to their migration-0019 DEFAULT
--     '[]'.

INSERT OR IGNORE INTO prompt_presets
  (slug, prompt_template, category, variables, is_system, is_active,
   name, description, system_prompt_template, user_prompt_template,
   text_model, image_model)
VALUES
  ('system-starter-articles',
   'Plan and write the starter set of evergreen {{vertical}} articles for {{brand_name}}.',
   'starter-articles', NULL, 1, 1,
   'Default Starter Articles preset',
   'System default for planning and writing the starter article set during provisioning.',
   'You are the founding editor for {{brand_name}}, a {{vertical}} publication serving {{audience}}.',
   'Plan a set of distinct, evergreen, vertical-appropriate starter articles for the new {{vertical}} site {{brand_name}}. Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.',
   'gpt-5.5', NULL),

  ('system-tagline',
   'Write a short brand tagline for {{brand_name}}.',
   'tagline', NULL, 1, 1,
   'Default Tagline preset',
   'System default for generating the site tagline during provisioning.',
   'You are a brand copywriter crafting taglines for {{brand_name}} in the {{vertical}} vertical.',
   'Write one short, memorable tagline under 60 characters for {{brand_name}}, a {{vertical}} site for {{audience}}.',
   'gpt-5.5', NULL),

  ('system-site-description',
   'Write the site meta description for {{brand_name}}.',
   'site-description', NULL, 1, 1,
   'Default Site Description preset',
   'System default for generating the site meta description during provisioning.',
   'You are an SEO copywriter for {{brand_name}} in the {{vertical}} vertical.',
   'Write a single-paragraph site description of at most 155 characters for {{brand_name}}, a {{vertical}} publication serving {{audience}}.',
   'gpt-5.5', NULL),

  ('system-logo',
   'Describe an on-brand logo image for {{brand_name}}.',
   'logo', NULL, 1, 1,
   'Default Logo preset',
   'System default for generating the site logo image during provisioning.',
   'You are a brand designer creating logo imagery for {{brand_name}} in the {{vertical}} vertical.',
   'Describe a clean, modern, on-brand logo for {{brand_name}}, suitable for a {{vertical}} site.',
   'gpt-5.5', 'gpt-image-2'),

  ('system-hero-image',
   'Describe the homepage hero image for {{brand_name}}.',
   'hero-image', NULL, 1, 1,
   'Default Hero Image preset',
   'System default for generating the homepage hero image during provisioning.',
   'You are an art director producing homepage hero imagery for {{brand_name}} in the {{vertical}} vertical.',
   'Describe a photorealistic, on-brand homepage hero image for {{brand_name}} in the {{vertical}} vertical.',
   'gpt-5.5', 'gpt-image-2'),

  ('system-feature-image',
   'Describe a feature image for the article {{title}}.',
   'feature-image', NULL, 1, 1,
   'Default Feature Image preset',
   'System default for generating an article feature image during provisioning.',
   'You are an art director producing editorial feature imagery for {{brand_name}} in the {{vertical}} vertical.',
   'Describe a photorealistic, on-brand feature image for the article {{title}} in the {{vertical}} vertical.',
   'gpt-5.5', 'gpt-image-2');
