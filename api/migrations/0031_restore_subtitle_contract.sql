-- Migration 0031 (round-5): restore the "subtitle" key 0030 silently dropped.
--
-- Root cause: 0027 amended the system-content contract (user_prompt_template)
-- with a required "subtitle" teaser — the field articles.subtitle and the
-- public hero render from. 0030 then moved the contract into output_rules but
-- was authored from the OLDER 0023 text, so the moved JSON shape lost the
-- "subtitle" key and its requirement line. Every article generated since
-- (pipeline starter articles AND the admin panel) comes back subtitle-less.
-- Proven live 2026-07-02: a full-article generation returned every contract
-- field EXCEPT subtitle; prod prompt_presets carries no 'subtitle' anywhere.
--
-- This restores 0027's subtitle contract VERBATIM into the 0030-shaped
-- output_rules: the JSON shape gains "subtitle": string after "title", and
-- the Requirements rule gains 0027's subtitle bullet as the first entry.
--
-- Conditional (D2): applies ONLY while the live contract still lacks
-- 'subtitle', so re-running is a no-op and a future operator-amended contract
-- that already asks for a subtitle is never clobbered.

UPDATE prompt_presets
SET output_rules = '["Return STRICT JSON ONLY (no markdown fences) with this exact shape:\n{\n  \"title\": string,\n  \"subtitle\": string,\n  \"key_idea\": string,\n  \"intro\": string,\n  \"sections\": [ { \"heading\": { \"level\": 2, \"text\": string }, \"paragraphs\": [string], \"bullets\": [string] } ],\n  \"takeaways\": [string],\n  \"editors_pick\": { \"title\": string, \"why\": string },\n  \"faqs\": [ { \"question\": string, \"answer\": string } ]\n}","Requirements:\n- subtitle: ONE short punchy teaser sentence (max ~14 words) that hooks the reader and makes them want to read on. It MUST be a tease, NOT a summary, and MUST be different from the intro and from any body paragraph. Do NOT restate the title and do NOT use a colon-prefixed label.\n- key_idea: ONE punchy, quotable sentence (max ~18 words) capturing the single most important insight. Not a restatement of the title.\n- intro: 2-3 short paragraphs separated by blank lines. Open with a concrete scene, tension, or a surprising specific. NEVER restate the title and NEVER open with \"X is a guide to\" or \"In today''s world\".\n- sections: 3 to 4 sections. Each heading.text is a SPECIFIC, search-friendly sub-topic (e.g. \"What actually changes at six months\"), never the article title and never a generic label like \"Overview\" or \"Conclusion\". Include \"bullets\" (3-6 items) ONLY where a list genuinely helps; otherwise omit bullets.\n- takeaways: 3-5 short, action-oriented points for a \"Key takeaways\" box.\n- editors_pick: one genuinely useful recommendation a real editor would make to a {{audience}} reader - a technique, habit, free resource, or approach. \"why\" is one or two sentences. Do NOT invent a product name, price, brand, or external link.\n- faqs: exactly 3 real questions a {{audience}} reader would actually search, with direct answers."]'
WHERE slug = 'system-content'
  AND category = 'content'
  AND instr(COALESCE(output_rules, ''), 'subtitle') = 0;
