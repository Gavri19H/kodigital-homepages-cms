// T5: Prompt module for site-tagline generation. Deterministic builder; no
// vertical-specific references. PROMPT_VERSION is the canonical slug used
// in ai_generations.prompt_version.

export const PROMPT_VERSION = "site-tagline:v1";

export interface BuildSiteTaglinePromptInput {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
}

export function buildPrompt(input: BuildSiteTaglinePromptInput): string {
  const vertical = (input.vertical || "").trim();
  const audience = (input.audience || "general").trim();
  const brand = (input.brand_name || "this site").trim();
  return [
    `You are writing a short site tagline for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Audience: ${audience}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- One sentence, max 90 characters.`,
    `- Plain prose; no quotes, no emoji.`,
    `- Do not invent statistics or testimonials.`,
    `- Use generic, vertical-appropriate language.`,
    `Return only the tagline text on a single line.`,
  ].join("\n");
}
