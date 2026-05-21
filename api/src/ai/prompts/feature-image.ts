// T5: Prompt module for feature-image generation. Editorial-style hero
// image; no text rendering inside the image. Deterministic builder.

export const PROMPT_VERSION = "feature-image:v1";

export interface BuildFeatureImagePromptInput {
  site_id: string;
  vertical: string;
  article_title: string;
  palette?: string;
}

export function buildPrompt(input: BuildFeatureImagePromptInput): string {
  const vertical = (input.vertical || "").trim();
  const title = (input.article_title || "").trim();
  const palette = (input.palette || "natural").trim();
  return [
    `You are creating an editorial feature image for an article.`,
    `Article title: ${title}.`,
    `Vertical: ${vertical}.`,
    `Palette: ${palette}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- Photographic or illustrative editorial composition relevant to the article topic.`,
    `- 16:9 landscape framing suitable for a hero banner.`,
    `- Do not include any letters, words, captions, or signage in the image.`,
    `- No real people's faces, no celebrities, no copyrighted characters or brand logos.`,
    `- No medical, financial, or legal advice depicted as authoritative.`,
    `Return an image only.`,
  ].join("\n");
}
