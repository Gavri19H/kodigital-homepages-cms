// T5: Prompt module for image alt-text generation. Short accessible
// description for screen readers. Deterministic builder.

export const PROMPT_VERSION = "alt-text:v1";

export interface BuildAltTextPromptInput {
  site_id: string;
  media_id: string;
  context_kind: "logo" | "feature_image" | "inline";
  article_title?: string;
  vertical?: string;
}

export function buildPrompt(input: BuildAltTextPromptInput): string {
  const vertical = (input.vertical || "").trim();
  const articleTitle = (input.article_title || "").trim();
  const titleLine = articleTitle ? `Article title: ${articleTitle}.` : "";
  return [
    `You are writing accessible alt-text for an image.`,
    `Media id: ${input.media_id}.`,
    `Context: ${input.context_kind}.`,
    titleLine,
    `Vertical: ${vertical}.`,
    `Site id: ${input.site_id}.`,
    `Constraints:`,
    `- One sentence, 80-125 characters.`,
    `- Plain factual description of what the image shows.`,
    `- Do not start with "Image of" or "Picture of".`,
    `- Do not include quotes, emoji, or markdown.`,
    `- No legacy product names; no marketing claims.`,
    `Return only the alt-text on a single line.`,
  ]
    .filter((s) => s !== "")
    .join("\n");
}
