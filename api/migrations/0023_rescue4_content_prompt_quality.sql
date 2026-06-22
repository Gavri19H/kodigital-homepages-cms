-- Migration 0023 (rescue-4 round-2 / PR-2a): raise the LIVE content-generation
-- prompt quality so provisioned starter articles read like a sharp human wrote
-- them, not AI fallback prose.
--
-- The live starter-article body generator (generateStarterArticle, text.ts)
-- resolves the 'content' use-case preset via resolveCategoryPreset. The only
-- is_system 'content' preset is the `system-content` row seeded by migration
-- 0016 (migration 0020 seeded the provisioning-TASK presets — starter-articles,
-- tagline, etc. — but NOT 'content'). So this migration UPDATEs that exact row
-- in place: it rewrites the System + User prompt templates to the anti-AI-tell,
-- structured-JSON authoring contract (key_idea / intro / sections+bullets /
-- takeaways / faqs; no em dashes; banned AI-tell phrases; no invented facts).
--
-- Idempotency: a single UPDATE keyed on the stable (slug='system-content',
-- category='content') identity migration 0016 created. Re-running it sets the
-- same text — no duplicate rows, no schema change. text_model is left
-- untouched (the LOCKED gpt-5.5 id from 0016). The {{vertical}} /
-- {{brand_name}} / {{audience}} / {{title}} / {{summary}} tokens are
-- exactly the ones 0016 declared and resolveCategoryPreset interpolates.

UPDATE prompt_presets
SET system_prompt_template = 'You are a seasoned {{vertical}} editor writing for {{brand_name}}. You write like a sharp, experienced human writing for {{audience}}: specific, warm, direct, with real opinions and concrete examples. You never sound like AI.',
    user_prompt_template = 'Write a genuinely useful article titled "{{title}}". Topic: {{summary}}.

Return STRICT JSON ONLY (no markdown fences) with this exact shape:
{
  "title": string,
  "key_idea": string,
  "intro": string,
  "sections": [ { "heading": { "level": 2, "text": string }, "paragraphs": [string], "bullets": [string] } ],
  "takeaways": [string],
  "editors_pick": { "title": string, "why": string },
  "faqs": [ { "question": string, "answer": string } ]
}

Requirements:
- key_idea: ONE punchy, quotable sentence (max ~18 words) capturing the single most important insight. Not a restatement of the title.
- intro: 2-3 short paragraphs separated by blank lines. Open with a concrete scene, tension, or a surprising specific. NEVER restate the title and NEVER open with "X is a guide to" or "In today''s world".
- sections: 3 to 4 sections. Each heading.text is a SPECIFIC, search-friendly sub-topic (e.g. "What actually changes at six months"), never the article title and never a generic label like "Overview" or "Conclusion". Include "bullets" (3-6 items) ONLY where a list genuinely helps; otherwise omit bullets.
- takeaways: 3-5 short, action-oriented points for a "Key takeaways" box.
- editors_pick: one genuinely useful recommendation a real editor would make to a {{audience}} reader - a technique, habit, free resource, or approach. "why" is one or two sentences. Do NOT invent a product name, price, brand, or external link.
- faqs: exactly 3 real questions a {{audience}} reader would actually search, with direct answers.

Voice rules:
- Plain human voice. Vary sentence length. Be concrete and specific.
- NEVER use em dashes. Use a comma, a period, or "and". Plain hyphens are fine.
- Ban these AI-tell phrases: "delve", "navigate the landscape", "in today''s fast-paced world", "when it comes to", "it is important to note", "a myriad of", "unlock", "elevate", "game-changer", "in conclusion".
- Be relevant to {{audience}} and, where natural, to the current season or what is top of mind now.
- Do NOT invent statistics, prices, brand names, studies, or quotes. Write from practical experience.
- Follow mainstream content policy: no medical/financial claims stated as fact; be helpful and safe.'
WHERE slug = 'system-content' AND category = 'content';
