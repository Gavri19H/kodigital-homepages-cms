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
  const audience = (input.audience || "general").trim();
  const brand = (input.brand_name || "this site").trim();
  const summary = (input.summary || "").trim();
  const summaryLine = summary ? `Summary: ${summary}.` : "";
  return [
    `You are writing a starter article for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Audience: ${audience}.`,
    `Article slug: ${input.slug}.`,
    `Article title: ${input.title}.`,
    summaryLine,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Output strict JSON matching GeneratedArticle shape: { "intro": string, "sections": Array<{ "heading": { "level": 2|3, "text": string }, "paragraphs": string[] }>, "faqs": Array<{ "question": string, "answer": string }> }.`,
    `- At least 3 sections with heading.level === 2 (h2).`,
    `- At least 3 entries in faqs.`,
    `- No lorem ipsum, no TODO, no FIXME, no placeholder text of any kind.`,
    `- No legacy product names; use generic, vertical-appropriate prose.`,
    `- Do not invent statistics, prices, locations, or contact details.`,
    `Return only the JSON object.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
