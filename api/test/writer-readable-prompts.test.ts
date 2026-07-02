// C11 — writer-readable prompts equivalence gate (migration 0030).
//
// Migration 0030 moves the machine output contract of the three seeded
// presets (system-content / system-outline / system-starter-articles) from
// the writer-facing user_prompt_template into output_rules. The single
// preset engine folds output_rules into every composed prompt (editor chat
// system message AND provisioning effectivePrompt), so the model must keep
// receiving the IDENTICAL contract text — this suite fails if the contract
// is dropped, altered, or stops being folded, and if the writer-facing
// prompt is not prose-only after the move.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPreset } from "../src/ai/generators/preset-engine";

const VARS = {
  vertical: "careers",
  brand_name: "BrandX",
  audience: "young professionals",
  title: "Test Title",
  summary: "Test summary",
};

function presetRow(overrides: Record<string, unknown>) {
  return {
    id: 1,
    slug: "x",
    prompt_template: null,
    system_prompt_template: null,
    user_prompt_template: null,
    text_model: null,
    content_mapping: null,
    output_rules: null,
    variables_schema: null,
    ...overrides,
  } as never;
}

// ---- The PRE-0030 seeded texts (verbatim from migrations 0023/0016/0020) ----

const OLD_CONTENT_USER = `Write a genuinely useful article titled "{{title}}". Topic: {{summary}}.

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
- intro: 2-3 short paragraphs separated by blank lines. Open with a concrete scene, tension, or a surprising specific. NEVER restate the title and NEVER open with "X is a guide to" or "In today's world".
- sections: 3 to 4 sections. Each heading.text is a SPECIFIC, search-friendly sub-topic (e.g. "What actually changes at six months"), never the article title and never a generic label like "Overview" or "Conclusion". Include "bullets" (3-6 items) ONLY where a list genuinely helps; otherwise omit bullets.
- takeaways: 3-5 short, action-oriented points for a "Key takeaways" box.
- editors_pick: one genuinely useful recommendation a real editor would make to a {{audience}} reader - a technique, habit, free resource, or approach. "why" is one or two sentences. Do NOT invent a product name, price, brand, or external link.
- faqs: exactly 3 real questions a {{audience}} reader would actually search, with direct answers.

Voice rules:
- Plain human voice. Vary sentence length. Be concrete and specific.
- NEVER use em dashes. Use a comma, a period, or "and". Plain hyphens are fine.
- Ban these AI-tell phrases: "delve", "navigate the landscape", "in today's fast-paced world", "when it comes to", "it is important to note", "a myriad of", "unlock", "elevate", "game-changer", "in conclusion".
- Be relevant to {{audience}} and, where natural, to the current season or what is top of mind now.
- Do NOT invent statistics, prices, brand names, studies, or quotes. Write from practical experience.
- Follow mainstream content policy: no medical/financial claims stated as fact; be helpful and safe.`;

const OLD_OUTLINE_USER =
  'Plan a set of distinct, evergreen, vertical-appropriate article ideas for the {{vertical}} site. Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.';

const OLD_STARTER_USER =
  'Plan a set of distinct, evergreen, vertical-appropriate starter articles for the new {{vertical}} site {{brand_name}}. Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.';

// ---- The POST-0030 values (must match the migration byte-for-byte) ----

const NEW_CONTENT_USER = `Write a genuinely useful article titled "{{title}}". Topic: {{summary}}.

Voice rules:
- Plain human voice. Vary sentence length. Be concrete and specific.
- NEVER use em dashes. Use a comma, a period, or "and". Plain hyphens are fine.
- Ban these AI-tell phrases: "delve", "navigate the landscape", "in today's fast-paced world", "when it comes to", "it is important to note", "a myriad of", "unlock", "elevate", "game-changer", "in conclusion".
- Be relevant to {{audience}} and, where natural, to the current season or what is top of mind now.
- Do NOT invent statistics, prices, brand names, studies, or quotes. Write from practical experience.
- Follow mainstream content policy: no medical/financial claims stated as fact; be helpful and safe.`;

const NEW_CONTENT_RULES = [
  `Return STRICT JSON ONLY (no markdown fences) with this exact shape:
{
  "title": string,
  "key_idea": string,
  "intro": string,
  "sections": [ { "heading": { "level": 2, "text": string }, "paragraphs": [string], "bullets": [string] } ],
  "takeaways": [string],
  "editors_pick": { "title": string, "why": string },
  "faqs": [ { "question": string, "answer": string } ]
}`,
  `Requirements:
- key_idea: ONE punchy, quotable sentence (max ~18 words) capturing the single most important insight. Not a restatement of the title.
- intro: 2-3 short paragraphs separated by blank lines. Open with a concrete scene, tension, or a surprising specific. NEVER restate the title and NEVER open with "X is a guide to" or "In today's world".
- sections: 3 to 4 sections. Each heading.text is a SPECIFIC, search-friendly sub-topic (e.g. "What actually changes at six months"), never the article title and never a generic label like "Overview" or "Conclusion". Include "bullets" (3-6 items) ONLY where a list genuinely helps; otherwise omit bullets.
- takeaways: 3-5 short, action-oriented points for a "Key takeaways" box.
- editors_pick: one genuinely useful recommendation a real editor would make to a {{audience}} reader - a technique, habit, free resource, or approach. "why" is one or two sentences. Do NOT invent a product name, price, brand, or external link.
- faqs: exactly 3 real questions a {{audience}} reader would actually search, with direct answers.`,
];

const NEW_OUTLINE_USER =
  "Plan a set of distinct, evergreen, vertical-appropriate article ideas for the {{vertical}} site.";
const NEW_STARTER_USER =
  "Plan a set of distinct, evergreen, vertical-appropriate starter articles for the new {{vertical}} site {{brand_name}}.";
const JSON_ITEMS_RULE =
  'Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.';

const CASES = [
  {
    name: "system-content",
    system:
      "You are a seasoned {{vertical}} editor writing for {{brand_name}}. You write like a sharp, experienced human writing for {{audience}}: specific, warm, direct, with real opinions and concrete examples. You never sound like AI.",
    oldUser: OLD_CONTENT_USER,
    newUser: NEW_CONTENT_USER,
    rules: NEW_CONTENT_RULES,
  },
  {
    name: "system-outline",
    system:
      "You are the editorial planner for {{brand_name}}, a {{vertical}} publication serving {{audience}}.",
    oldUser: OLD_OUTLINE_USER,
    newUser: NEW_OUTLINE_USER,
    rules: [JSON_ITEMS_RULE],
  },
  {
    name: "system-starter-articles",
    system:
      "You are the founding editor for {{brand_name}}, a {{vertical}} publication serving {{audience}}.",
    oldUser: OLD_STARTER_USER,
    newUser: NEW_STARTER_USER,
    rules: [JSON_ITEMS_RULE],
  },
];

// The interpolated form of a contract segment (what the model actually sees).
function interp(text: string): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name: string) => {
    const v = (VARS as Record<string, string>)[name];
    return v !== undefined && v !== "" ? v : whole;
  });
}

describe("C11 — 0030 moves the output contract without altering what the model receives", () => {
  for (const c of CASES) {
    it(`${c.name}: contract preserved verbatim, writer prompt prose-only`, () => {
      const before = applyPreset({
        preset: presetRow({ system_prompt_template: c.system, user_prompt_template: c.oldUser }),
        variables: VARS,
      });
      const after = applyPreset({
        preset: presetRow({
          system_prompt_template: c.system,
          user_prompt_template: c.newUser,
          output_rules: JSON.stringify(c.rules),
        }),
        variables: VARS,
      });

      for (const rule of c.rules) {
        const seg = interp(rule.trim());
        // The contract existed verbatim before the move…
        expect(before.effectivePrompt).toContain(seg);
        // …and the model still receives it after — in the provisioning
        // effectivePrompt AND in the editor-chat system message.
        expect(after.effectivePrompt).toContain(seg);
        expect(after.systemPrompt).toContain(seg);
        // …while the writer-facing prompt no longer carries it.
        expect(after.userPrompt).not.toContain(seg);
      }

      // The kept prose still reaches the model.
      expect(after.effectivePrompt).toContain(interp(c.newUser).split("\n")[0]);
      // Writer-facing prompt is prose-only: no JSON braces after interpolation.
      expect(after.userPrompt).not.toContain("{");
      expect(after.userPrompt.trim().length).toBeGreaterThan(0);
    });
  }

  it("migration 0030 carries exactly these values (anchors)", () => {
    const sql = readFileSync(
      join(__dirname, "..", "migrations", "0030_writer_readable_prompts.sql"),
      "utf-8",
    );
    // Distinctive anchors tie the fixtures to the shipped SQL.
    expect(sql).toContain("Return STRICT JSON ONLY (no markdown fences) with this exact shape:");
    expect(sql).toContain('\\"key_idea\\": string');
    expect(sql).toContain("Voice rules:");
    expect(sql).toContain(
      "Plan a set of distinct, evergreen, vertical-appropriate article ideas for the {{vertical}} site.',",
    );
    expect(sql).toContain(
      "Plan a set of distinct, evergreen, vertical-appropriate starter articles for the new {{vertical}} site {{brand_name}}.',",
    );
    expect(sql).toContain("WHERE slug = 'system-content' AND category = 'content'");
    expect(sql).toContain("WHERE slug = 'system-outline' AND category = 'outline'");
    expect(sql).toContain(
      "WHERE slug = 'system-starter-articles' AND category = 'starter-articles'",
    );
    // The SQL user_prompt_template values must not smuggle the contract back.
    const contentUpdate = sql.split("WHERE slug = 'system-content'")[0] ?? "";
    const userTemplateSql =
      (contentUpdate.split("user_prompt_template = '")[1] ?? "").split("',")[0] ?? "";
    expect(userTemplateSql.length).toBeGreaterThan(0);
    expect(userTemplateSql).not.toContain("STRICT JSON");
    expect(userTemplateSql).not.toContain("Requirements:");
  });
});
