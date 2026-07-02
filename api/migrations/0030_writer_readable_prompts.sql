-- Migration 0030: writer-readable prompts — move the machine output contract
-- out of the writer-facing user_prompt_template into output_rules.
--
-- WHY: the editor AI panel previews user_prompt_template to WRITERS. The
-- seeds (0016/0020/0023) baked the strict-JSON output contract into that
-- text, so writers saw a wall of JSON. The schema has a dedicated
-- output_rules column (0019) and the single preset engine
-- (preset-engine.ts renderOutputRules) folds free-text rules into every
-- composed prompt — editor chat (applyChatPreset -> systemPrompt) AND
-- provisioning (resolveCategoryPreset -> effectivePrompt) alike. Moving the
-- contract VERBATIM changes where it rides, not what the model receives.
-- test/writer-readable-prompts.test.ts pins that equivalence.
--
-- Idempotent: UPDATEs keyed on the stable seeded slugs set fixed text.

-- 1. system-content (seeded 0016, rewritten 0023): prose + voice rules stay
--    writer-facing; the JSON shape + structural requirements become rules.
UPDATE prompt_presets
SET user_prompt_template = 'Write a genuinely useful article titled "{{title}}". Topic: {{summary}}.

Voice rules:
- Plain human voice. Vary sentence length. Be concrete and specific.
- NEVER use em dashes. Use a comma, a period, or "and". Plain hyphens are fine.
- Ban these AI-tell phrases: "delve", "navigate the landscape", "in today''s fast-paced world", "when it comes to", "it is important to note", "a myriad of", "unlock", "elevate", "game-changer", "in conclusion".
- Be relevant to {{audience}} and, where natural, to the current season or what is top of mind now.
- Do NOT invent statistics, prices, brand names, studies, or quotes. Write from practical experience.
- Follow mainstream content policy: no medical/financial claims stated as fact; be helpful and safe.',
    output_rules = '["Return STRICT JSON ONLY (no markdown fences) with this exact shape:\n{\n  \"title\": string,\n  \"key_idea\": string,\n  \"intro\": string,\n  \"sections\": [ { \"heading\": { \"level\": 2, \"text\": string }, \"paragraphs\": [string], \"bullets\": [string] } ],\n  \"takeaways\": [string],\n  \"editors_pick\": { \"title\": string, \"why\": string },\n  \"faqs\": [ { \"question\": string, \"answer\": string } ]\n}","Requirements:\n- key_idea: ONE punchy, quotable sentence (max ~18 words) capturing the single most important insight. Not a restatement of the title.\n- intro: 2-3 short paragraphs separated by blank lines. Open with a concrete scene, tension, or a surprising specific. NEVER restate the title and NEVER open with \"X is a guide to\" or \"In today''s world\".\n- sections: 3 to 4 sections. Each heading.text is a SPECIFIC, search-friendly sub-topic (e.g. \"What actually changes at six months\"), never the article title and never a generic label like \"Overview\" or \"Conclusion\". Include \"bullets\" (3-6 items) ONLY where a list genuinely helps; otherwise omit bullets.\n- takeaways: 3-5 short, action-oriented points for a \"Key takeaways\" box.\n- editors_pick: one genuinely useful recommendation a real editor would make to a {{audience}} reader - a technique, habit, free resource, or approach. \"why\" is one or two sentences. Do NOT invent a product name, price, brand, or external link.\n- faqs: exactly 3 real questions a {{audience}} reader would actually search, with direct answers."]'
WHERE slug = 'system-content' AND category = 'content';

-- 2. system-outline (seeded 0016): the planning sentence stays; the JSON
--    shape becomes a rule.
UPDATE prompt_presets
SET user_prompt_template = 'Plan a set of distinct, evergreen, vertical-appropriate article ideas for the {{vertical}} site.',
    output_rules = '["Output strict JSON: { \"items\": Array<{ \"slug\": string, \"title\": string, \"summary\": string }> }."]'
WHERE slug = 'system-outline' AND category = 'outline';

-- 3. system-starter-articles (seeded 0020): same split.
UPDATE prompt_presets
SET user_prompt_template = 'Plan a set of distinct, evergreen, vertical-appropriate starter articles for the new {{vertical}} site {{brand_name}}.',
    output_rules = '["Output strict JSON: { \"items\": Array<{ \"slug\": string, \"title\": string, \"summary\": string }> }."]'
WHERE slug = 'system-starter-articles' AND category = 'starter-articles';
