import type { Env } from "../env";

// T1: AI model registry. Single source of truth for which OpenAI model
// IDs the worker is allowed to address. The two literal model IDs below
// are part of the typed RED-LINE contract for change
// cms-new-phase6-ai-2026-05-20 — do NOT paraphrase or generalize.
export const SUPPORTED_TEXT_MODELS = ["gpt-5.5"] as const;
export const SUPPORTED_IMAGE_MODELS = ["gpt-image-2"] as const;

export type SupportedTextModel = (typeof SUPPORTED_TEXT_MODELS)[number];
export type SupportedImageModel = (typeof SUPPORTED_IMAGE_MODELS)[number];

export const DEFAULT_TEXT_MODEL: SupportedTextModel = "gpt-5.5";
export const DEFAULT_IMAGE_MODEL: SupportedImageModel = "gpt-image-2";

export function getTextModel(env: Env): SupportedTextModel {
  const raw = env.OPENAI_TEXT_MODEL;
  const candidate = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_TEXT_MODEL;
  assertSupportedTextModel(candidate);
  return candidate as SupportedTextModel;
}

export function getImageModel(env: Env): SupportedImageModel {
  const raw = env.OPENAI_IMAGE_MODEL;
  const candidate = raw && raw.trim() !== "" ? raw.trim() : DEFAULT_IMAGE_MODEL;
  assertSupportedImageModel(candidate);
  return candidate as SupportedImageModel;
}

export function assertSupportedTextModel(
  model: string,
): asserts model is SupportedTextModel {
  if (!(SUPPORTED_TEXT_MODELS as readonly string[]).includes(model)) {
    throw new Error(
      `Unsupported OPENAI_TEXT_MODEL: ${model}. Supported: ${SUPPORTED_TEXT_MODELS.join(", ")}`,
    );
  }
}

export function assertSupportedImageModel(
  model: string,
): asserts model is SupportedImageModel {
  if (!(SUPPORTED_IMAGE_MODELS as readonly string[]).includes(model)) {
    throw new Error(
      `Unsupported OPENAI_IMAGE_MODEL: ${model}. Supported: ${SUPPORTED_IMAGE_MODELS.join(", ")}`,
    );
  }
}
