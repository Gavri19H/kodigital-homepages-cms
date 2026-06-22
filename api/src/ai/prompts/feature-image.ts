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
  // PR-2b: the no-preset fallback builder mirrors the LIVE 'feature-image'
  // preset (migration 0024) — an editorial photo director brief that asks for
  // ONE specific, evocative, real-world moment (NOT a literal label of the
  // title), with the treatment varied so per-article images are visually
  // distinct and look like real editorial photography rather than samey,
  // staged catalog/stock or AI clip-art. Deterministic for the same input.
  return [
    `You are an editorial photo director. Describe ONE specific, evocative editorial image for the article "${title}" in the ${vertical} space.`,
    `Capture a concrete real-world moment that conveys the article's core idea, not a literal label of the title.`,
    `Vary the treatment - choose ONE: a candid over-the-shoulder moment; a warm close-up detail; a wide environmental scene; a hands-at-work top-down; or a natural portrait with the subject looking straight at the camera.`,
    `If a person faces away or is mid-action, keep it natural and unposed, never staged or acting.`,
    `Use natural directional light, shallow depth of field, real textures, and a calm modern ${palette} palette.`,
    `A soft illustrative or gentle cartoon style is allowed when it genuinely suits the subject.`,
    `Each image must be visually distinct from the others and look like a real editorial photograph, never generic stock or AI clip-art.`,
    `No text, no words, no captions, no logos, no watermarks, no collage. No celebrities, no copyrighted characters or brand logos. No medical, financial, or legal advice depicted as authoritative.`,
    `16:9 landscape.`,
  ].join("\n");
}
