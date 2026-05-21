// T5: Prompt module for article SEO metadata generation. Produces
// meta_title, meta_description, optional social variants. Deterministic
// builder.

export const PROMPT_VERSION = "article-seo:v1";

export interface BuildArticleSEOPromptInput {
  site_id: string;
  vertical: string;
  article_slug: string;
  article_title: string;
  article_intro?: string;
}

export function buildPrompt(input: BuildArticleSEOPromptInput): string {
  const vertical = (input.vertical || "").trim();
  const intro = (input.article_intro || "").trim();
  const introLine = intro ? `Intro: ${intro}.` : "";
  return [
    `You are writing SEO metadata for an article.`,
    `Article slug: ${input.article_slug}.`,
    `Article title: ${input.article_title}.`,
    introLine,
    `Vertical: ${vertical}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Output strict JSON: { "meta_title": string, "meta_description": string, "social_title"?: string, "social_description"?: string }.`,
    `- meta_title: 50-60 characters; reflects the article title; no clickbait; no quotes.`,
    `- meta_description: 140-160 characters; one or two plain sentences.`,
    `- social_title and social_description optional; same constraints when present.`,
    `- Do not invent statistics, prices, or testimonials.`,
    `- No legacy product names; use generic vertical-appropriate language.`,
    `Return only the JSON object.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
