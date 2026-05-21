// T5: Prompt module for starter-article-plan generation. Produces a list
// of 15 article slugs+titles+summaries for a new site. Deterministic
// builder.

export const PROMPT_VERSION = "starter-article-plan:v1";

export interface BuildStarterArticlePlanPromptInput {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
}

export function buildPrompt(input: BuildStarterArticlePlanPromptInput): string {
  const vertical = (input.vertical || "").trim();
  const audience = (input.audience || "general").trim();
  const brand = (input.brand_name || "this site").trim();
  return [
    `You are planning 15 starter articles for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Audience: ${audience}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.`,
    `- Exactly 15 items; all slugs unique; slugs are lowercase kebab-case.`,
    `- Titles are concise, vertical-appropriate, evergreen.`,
    `- Summaries are 1-2 sentences describing what the article will cover.`,
    `- Do not invent statistics, prices, locations, or contact details.`,
    `- Use generic prose; no legacy product names; no clickbait.`,
    `Return only the JSON object.`,
  ].join("\n");
}
