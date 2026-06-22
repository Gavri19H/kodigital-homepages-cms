// T5: Prompt module for one starter-article generation. Output must
// validate via validateGeneratedArticle (>=3 h2 sections, >=3 FAQs, no
// placeholder text, no banned legacy refs).

export const PROMPT_VERSION = "starter-article:v1";

export interface BuildStarterArticlePromptInput {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
  slug: string;
  title: string;
  summary?: string;
}

export function buildPrompt(input: BuildStarterArticlePromptInput): string {
  const vertical = (input.vertical || "").trim();
  const audience = (input.audience || "general readers").trim();
  const brand = (input.brand_name || "this site").trim();
  const summary = (input.summary || "").trim();
  // PR-2a: the no-preset fallback builder mirrors the LIVE 'content' preset
  // (migration 0023) — a sharp, human, anti-AI-tell authoring contract that
  // emits the extended GeneratedArticle JSON (key_idea / intro paragraphs /
  // sections+bullets / takeaways / faqs). Still satisfies validateGeneratedArticle
  // (>=3 h2, >=3 faqs, no placeholder/legacy refs, no invented facts).
  return [
    `You are a seasoned ${vertical} editor writing for ${brand}. You write like a sharp, experienced human writing for ${audience}: specific, warm, direct, with real opinions and concrete examples. You never sound like AI.`,
    ``,
    `Write a genuinely useful article titled "${input.title}".${summary ? ` Topic: ${summary}.` : ""}`,
    ``,
    `Return STRICT JSON ONLY (no markdown fences) with this exact shape:`,
    `{`,
    `  "title": string,`,
    `  "key_idea": string,`,
    `  "intro": string,`,
    `  "sections": [ { "heading": { "level": 2, "text": string }, "paragraphs": [string], "bullets": [string] } ],`,
    `  "takeaways": [string],`,
    `  "editors_pick": { "title": string, "why": string },`,
    `  "faqs": [ { "question": string, "answer": string } ]`,
    `}`,
    ``,
    `Requirements:`,
    `- key_idea: ONE punchy, quotable sentence (max ~18 words) capturing the single most important insight. Not a restatement of the title.`,
    `- intro: 2-3 short paragraphs separated by blank lines. Open with a concrete scene, tension, or a surprising specific. NEVER restate the title and NEVER open with "X is a guide to" or "In today's world".`,
    `- sections: 3 to 4 sections. Each heading.text is a SPECIFIC, search-friendly sub-topic (e.g. "What actually changes at six months"), never the article title and never a generic label like "Overview" or "Conclusion". Include "bullets" (3-6 items) ONLY where a list genuinely helps; otherwise omit bullets.`,
    `- takeaways: 3-5 short, action-oriented points for a "Key takeaways" box.`,
    `- editors_pick: one genuinely useful recommendation a real editor would make to a ${audience} reader - a technique, habit, free resource, or approach. "why" is one or two sentences. Do NOT invent a product name, price, brand, or external link.`,
    `- faqs: exactly 3 real questions a ${audience} reader would actually search, with direct answers.`,
    ``,
    `Voice rules:`,
    `- Plain human voice. Vary sentence length. Be concrete and specific.`,
    `- NEVER use em dashes. Use a comma, a period, or "and". Plain hyphens are fine.`,
    `- Ban these AI-tell phrases: "delve", "navigate the landscape", "in today's fast-paced world", "when it comes to", "it is important to note", "a myriad of", "unlock", "elevate", "game-changer", "in conclusion".`,
    `- Be relevant to ${audience} and, where natural, to the current season or what is top of mind now.`,
    `- Do NOT invent statistics, prices, brand names, studies, or quotes. Write from practical experience.`,
    `- Follow mainstream content policy: no medical/financial claims stated as fact; be helpful and safe.`,
  ].join("\n");
}
