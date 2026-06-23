-- Migration 0027 (rescue-4 round-3): add a teaser `subtitle` to articles and
-- teach the LIVE content generator to produce one.
--
-- (a) Schema: articles gains a nullable `subtitle TEXT` column (no default).
--     ALTER TABLE ... ADD COLUMN is a safe single-run migration on D1/SQLite;
--     existing rows get NULL. This is NOT idempotent on its own (a second run
--     errors "duplicate column"), but the D1 migration ledger applies each
--     numbered file exactly once, so that is fine.
--
-- (b) Prompt: the live starter-article body generator (generateStarterArticle
--     in text.ts) resolves the 'content' use-case preset via
--     resolveCategoryPreset; the only is_system 'content' preset is the
--     `system-content` row (seeded by 0016, last rewritten by 0023). This
--     migration UPDATEs that exact row in place so generation also returns a
--     SHORT TEASER subtitle distinct from the intro and the body. It is the
--     SAME contract 0023 set, PLUS a "subtitle" key in the required JSON shape
--     and a requirement line describing the teaser. system_prompt_template is
--     left byte-identical to 0023 (no change needed). text_model is untouched.
--
-- Idempotency of (b): a single UPDATE keyed on the stable
-- (slug='system-content', category='content') identity — re-running sets the
-- same text, no duplicate rows. Apostrophes in the prose are SQL-escaped as
-- '' (e.g. today''s, editor''s) so the single-quoted string parses.

-- (a) Nullable teaser column.
ALTER TABLE articles ADD COLUMN subtitle TEXT;

-- (b) Refresh the live system-content preset to also emit a teaser subtitle.
UPDATE prompt_presets
SET user_prompt_template = 'Write a genuinely useful article titled "{{title}}". Topic: {{summary}}.

Return STRICT JSON ONLY (no markdown fences) with this exact shape:
{
  "title": string,
  "subtitle": string,
  "key_idea": string,
  "intro": string,
  "sections": [ { "heading": { "level": 2, "text": string }, "paragraphs": [string], "bullets": [string] } ],
  "takeaways": [string],
  "editors_pick": { "title": string, "why": string },
  "faqs": [ { "question": string, "answer": string } ]
}

Requirements:
- subtitle: ONE short punchy teaser sentence (max ~14 words) that hooks the reader and makes them want to read on. It MUST be a tease, NOT a summary, and MUST be different from the intro and from any body paragraph. Do NOT restate the title and do NOT use a colon-prefixed label.
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
