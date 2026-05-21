// T5: Prompt module for about-page generation. Returns JSON-shaped output
// matching GeneratedAboutPage; deterministic builder.

export const PROMPT_VERSION = "about-page:v1";

export interface BuildAboutPagePromptInput {
  site_id: string;
  vertical: string;
  audience?: string;
  brand_name?: string;
}

export function buildPrompt(input: BuildAboutPagePromptInput): string {
  const vertical = (input.vertical || "").trim();
  const audience = (input.audience || "general").trim();
  const brand = (input.brand_name || "this site").trim();
  return [
    `You are writing the About page for ${brand}.`,
    `Vertical: ${vertical}.`,
    `Audience: ${audience}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Output strict JSON matching: { "title": string, "body": Array<{ "type": "p"|"h2"|"ul", "text"?: string, "items"?: string[] }> }.`,
    `- 2-4 h2 sections; each followed by 1-2 p blocks.`,
    `- One ul block with 3-5 short items.`,
    `- Use generic, vertical-appropriate prose. No legacy product names.`,
    `- Do not invent statistics, testimonials, contact details, or prices.`,
    `Return only the JSON object.`,
  ].join("\n");
}
