// T5: Prompt module for site-description generation. Deterministic
// builder; no vertical-specific or legacy product references.

export const PROMPT_VERSION = "site-description:v1";

export interface BuildSiteDescriptionPromptInput {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
  tagline?: string;
}

export function buildPrompt(input: BuildSiteDescriptionPromptInput): string {
  const vertical = (input.vertical || "").trim();
  const audience = (input.audience || "general").trim();
  const brand = (input.brand_name || "this site").trim();
  const tagline = (input.tagline || "").trim();
  const taglineLine = tagline ? `Tagline: ${tagline}.` : "";
  return [
    `You are writing a meta description for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Audience: ${audience}.`,
    taglineLine,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Two sentences, 140-160 characters total.`,
    `- Plain prose; no quotes, no emoji, no hyperbole.`,
    `- Describe what the site offers in vertical-appropriate language.`,
    `- Do not invent statistics, prices, or contact details.`,
    `Return only the description text on a single line.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
