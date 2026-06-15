-- Migration 0016 (Phase 9 / T13): seed the default is_system prompt presets.
--
-- T13-AC1 wires generation to read prompt_presets by use-case category:
-- generateStarterArticlePlan resolves the 'outline' preset and
-- generateStarterArticle resolves the 'content' preset (see
-- api/src/ai/generators/preset-resolver.ts). For EVERY lookup to resolve,
-- this migration seeds one is_system=1 default preset per use-case category
-- in the full enum: title / excerpt / outline / content / seo / image /
-- custom.
--
-- T13-AC2 invariants:
--   * is_system = 1 (these are the platform defaults, not user presets).
--   * INSERT OR IGNORE on the slug UNIQUE index (migration 0001) → the seed
--     is idempotent: re-running the migration inserts nothing new.
--   * A fresh site otherwise has ZERO prompt_presets rows — the only rows
--     this migration creates are these 7 system defaults; non-system presets
--     are added exclusively through the admin AI Presets UI (T12).
--   * prompt_template (NOT NULL from migration 0001) is populated for legacy
--     callers; the reference System/User split (migration 0014) carries the
--     {{vertical}}/{{brand_name}}/{{title}}/{{summary}} interpolation tokens
--     the resolver substitutes at generation time.
--   * text_model is the single SUPPORTED_TEXT_MODELS id (gpt-5.5); image_model
--     is the single SUPPORTED_IMAGE_MODELS id (gpt-image-2) for the image
--     use-case. No unsupported model id is baked in.

INSERT OR IGNORE INTO prompt_presets
  (slug, prompt_template, category, variables, is_system, is_active,
   name, description, system_prompt_template, user_prompt_template,
   text_model, image_model)
VALUES
  ('system-title',
   'Write a concise, vertical-appropriate headline for {{title}}.',
   'title', NULL, 1, 1,
   'Default Title preset',
   'System default for generating article titles.',
   'You are an expert {{vertical}} editor writing headlines for {{brand_name}}.',
   'Write a concise, compelling, evergreen headline about {{title}} for the {{vertical}} audience.',
   'gpt-5.5', NULL),

  ('system-excerpt',
   'Write a one-sentence excerpt summarizing {{title}}.',
   'excerpt', NULL, 1, 1,
   'Default Excerpt preset',
   'System default for generating article excerpts.',
   'You are an expert {{vertical}} editor writing standfirst excerpts for {{brand_name}}.',
   'Write a single-sentence excerpt that summarizes {{title}} for {{vertical}} readers.',
   'gpt-5.5', NULL),

  ('system-outline',
   'Plan a set of evergreen {{vertical}} article ideas for {{brand_name}}.',
   'outline', NULL, 1, 1,
   'Default Outline preset',
   'System default for planning the starter article set (15 ideas).',
   'You are the editorial planner for {{brand_name}}, a {{vertical}} publication serving {{audience}}.',
   'Plan a set of distinct, evergreen, vertical-appropriate article ideas for the {{vertical}} site. Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.',
   'gpt-5.5', NULL),

  ('system-content',
   'Write a full {{vertical}} article titled {{title}}.',
   'content', NULL, 1, 1,
   'Default Content preset',
   'System default for generating full starter article bodies.',
   'You are an expert {{vertical}} writer producing in-depth articles for {{brand_name}} and its {{audience}} audience.',
   'Write a full article titled "{{title}}" about {{summary}} for the {{vertical}} audience. Output strict JSON matching the GeneratedArticle shape with at least 3 h2 sections and at least 3 FAQs.',
   'gpt-5.5', NULL),

  ('system-seo',
   'Write an SEO meta title and description for {{title}}.',
   'seo', NULL, 1, 1,
   'Default SEO preset',
   'System default for generating article SEO metadata.',
   'You are an SEO specialist optimizing {{vertical}} content for {{brand_name}}.',
   'Write an SEO meta_title (<=60 chars) and meta_description (<=155 chars) for the article {{title}}.',
   'gpt-5.5', NULL),

  ('system-image',
   'Describe a hero image for {{title}}.',
   'image', NULL, 1, 1,
   'Default Image preset',
   'System default for generating article hero-image prompts.',
   'You are an art director producing editorial hero imagery for {{brand_name}} ({{vertical}}).',
   'Describe a photorealistic, on-brand hero image for the article {{title}} in the {{vertical}} vertical.',
   'gpt-5.5', 'gpt-image-2'),

  ('system-custom',
   'Custom generation prompt for {{title}}.',
   'custom', NULL, 1, 1,
   'Default Custom preset',
   'System default catch-all preset for custom generation use-cases.',
   'You are a helpful {{vertical}} content assistant for {{brand_name}}.',
   'Generate content for {{title}} as instructed for the {{vertical}} audience.',
   'gpt-5.5', NULL);
