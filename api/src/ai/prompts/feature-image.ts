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
    `You are a world-class editorial photo director. Describe ONE specific, evocative, photoreal editorial photograph for the article "${title}" in the ${vertical} space.`,
    `Capture a concrete real-world moment that conveys the article's core idea, not a literal label of the title.`,
    `Vary the treatment - choose ONE: a wide environmental scene; a tight macro detail; a hands-at-work top-down flat-lay; a candid mid-action moment; a natural portrait looking straight at the camera; or a place-led frame of the space itself.`,
    `AVOID the overused cliche of a person seen from behind sitting at a laptop or at a desk of pinned photos.`,
    `Use natural directional light, shallow depth of field, real textures, and a refined modern ${palette} palette.`,
    `Photoreal only - never an illustration, cartoon, 3D render, or clip-art.`,
    `Each image must be visually distinct from the others and look like a real, professionally shot editorial photograph, never generic stock.`,
    `No text, no words, no captions, no logos, no watermarks, no charts, no collage. No celebrities, no copyrighted characters or brand logos. No medical, financial, or legal advice depicted as authoritative.`,
    `16:9 landscape, magazine quality.`,
  ].join("\n");
}
