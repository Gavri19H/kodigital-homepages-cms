-- Migration 0029 (rescue-4 round-4 / issue 1): the provisioned feature AND hero
-- images still read as generic, repetitive, illustrative stock (faceless person
-- at a laptop). Two root causes fixed here:
--   1. The hero preset (system-hero-image, seeded 0020) was NEVER updated and
--      stayed fully generic ("photorealistic, on-brand homepage hero image").
--   2. The feature preset (0024) still permitted "a soft illustrative or gentle
--      cartoon style" and did not forbid the over-the-shoulder-at-a-laptop cliche.
--
-- This migration rewrites BOTH is_system image presets in place (idempotent
-- UPDATEs keyed on the stable slug+category identity 0020 created): photoreal
-- ONLY, magazine-cover quality, explicitly anti-cliche, and the feature prompt
-- now consumes a {{art_direction}} token that api/src/ai/generators/image.ts
-- interpolates with a deterministic PER-ARTICLE directive (slug-seeded) so the
-- 15 article images are genuinely distinct instead of one repeated shot.
--
-- text_model / image_model are untouched (LOCKED gpt-5.5 / gpt-image-2 from 0020).
-- {{title}} / {{vertical}} / {{brand_name}} are the tokens generateFeatureImage
-- passes to resolveCategoryPreset; {{art_direction}} is the new per-article one.

UPDATE prompt_presets
SET system_prompt_template = 'You are a world-class editorial photo director for {{brand_name}}, a serious {{vertical}} publication. Every image must look like a real, professionally shot editorial photograph that a respected magazine would run, and must be visually distinct from the others in the set. Never generic stock, never AI clip-art, never a flat illustration or cartoon.',
    user_prompt_template = 'Create ONE specific, evocative, photoreal editorial photograph for the article "{{title}}" in the {{vertical}} space. {{art_direction}} Convey the article''s core idea through a concrete real-world moment, not a literal label of the title. Photoreal only: never an illustration, cartoon, 3D render, or clip-art. AVOID the overused cliche of a person seen from behind sitting at a laptop or at a desk of pinned photos. Real textures, intentional composition, and a refined modern restrained palette. No text, words, letters, captions, logos, watermarks, charts, diagrams, or collage. 16:9 landscape, magazine-cover quality.',
    prompt_template = 'A specific, evocative, photoreal editorial photograph for the article {{title}} in the {{vertical}} space for {{brand_name}}: a concrete real-world moment, not a literal label, never generic stock or illustration.'
WHERE slug = 'system-feature-image' AND category = 'feature-image';

UPDATE prompt_presets
SET system_prompt_template = 'You are a world-class editorial photo director for {{brand_name}}, a serious {{vertical}} publication. The homepage hero must look like a real, professionally shot magazine-cover photograph: striking, editorial, and credible. Never generic stock, never AI clip-art, never a flat illustration or cartoon.',
    user_prompt_template = 'Create ONE striking, photoreal editorial hero photograph that captures the world of {{brand_name}}, a {{vertical}} publication. Evoke the theme through a strong real-world scene with depth and atmosphere, not a literal label and not a person seen from behind at a laptop. Photoreal only: never an illustration, cartoon, 3D render, or clip-art. Real textures, intentional composition, natural directional light, a refined modern palette, and a quieter area toward one side where a headline could sit. No text, words, letters, logos, watermarks, charts, or collage. 16:9 landscape, magazine-cover quality.',
    prompt_template = 'A striking, photoreal editorial hero photograph for {{brand_name}}, a {{vertical}} publication, magazine-cover quality, never generic stock or illustration.'
WHERE slug = 'system-hero-image' AND category = 'hero-image';
