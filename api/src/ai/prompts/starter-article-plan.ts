// T5: Prompt module for starter-article-plan generation. Produces a list
// of `count` article slugs+titles+summaries for a new site. Deterministic
// builder. `count` is the end-to-end provisioning knob (STARTER_ARTICLE_TARGET)
// threaded down so the prompt asks the model for exactly that many items.

export const PROMPT_VERSION = "starter-article-plan:v1";

export interface BuildStarterArticlePlanPromptInput {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
  // rescue-4: how many starter articles to plan. Threaded from
  // STARTER_ARTICLE_TARGET so the prompt's "planning N" / "Exactly N items"
  // wording matches the count the materialize step will actually provision.
  count: number;
}

export function buildPrompt(input: BuildStarterArticlePlanPromptInput): string {
  const vertical = (input.vertical || "").trim();
  const audience = (input.audience || "general").trim();
  const brand = (input.brand_name || "this site").trim();
  const count = input.count;
  return [
    `You are planning ${count} starter articles for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Audience: ${audience}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Output strict JSON: { "items": Array<{ "slug": string, "title": string, "summary": string }> }.`,
    `- Exactly ${count} items; all slugs unique; slugs are lowercase kebab-case.`,
    `- Titles are concise, vertical-appropriate, evergreen.`,
    `- Summaries are 1-2 sentences describing what the article will cover.`,
    `- Do not invent statistics, prices, locations, or contact details.`,
    `- Use generic prose; no legacy product names; no clickbait.`,
    `Return only the JSON object.`,
  ].join("\n");
}
