// T7 [BCL-032]: structured, preset-driven /api/admin/ai/chat.
//
// The legacy assistant sent only {prompt}; the server read only body.prompt;
// the preset was never sent, no system prompt was applied, and the tone/length
// controls were baked into the prompt text then ignored (length-to-tokens
// absent). This module is the pure preset-application engine the chat endpoint
// calls so the behavioral contract is unit-testable without a live model:
//
//   - a selected preset's system_prompt_template (interpolated with the posted
//     {{variables}}) becomes the system message and OVERRIDES the requested
//     tone — the preset embodies its own voice, so options.tone is dropped;
//   - with NO preset, the per-action default system prompt is built from
//     options.tone;
//   - options.length short/medium/long maps to a max_tokens budget derived
//     from a ~400/800/1500-word target (no/unknown length => the medium
//     default).

import type { PresetRow } from "./ai-presets";

export type ChatLength = "short" | "medium" | "long";

// AC1: length short/medium/long maps to max_tokens budgets (~400/800/1500
// words). The word targets are the contract; tokens are derived (≈0.75 words
// per token — the OpenAI rule of thumb) so the budget the model receives
// tracks the word target.
export const LENGTH_WORD_BUDGETS: Record<ChatLength, number> = {
  short: 400,
  medium: 800,
  long: 1500,
};

const WORDS_PER_TOKEN = 0.75;
const DEFAULT_LENGTH: ChatLength = "medium";
const DEFAULT_TONE = "professional";

export function normalizeLength(raw: unknown): ChatLength {
  if (raw === "short" || raw === "medium" || raw === "long") return raw;
  return DEFAULT_LENGTH;
}

export function lengthToMaxTokens(raw: unknown): number {
  const length = normalizeLength(raw);
  return Math.ceil(LENGTH_WORD_BUDGETS[length] / WORDS_PER_TOKEN);
}

// {{token}} interpolation. Unknown / empty tokens are left verbatim so a
// half-filled preview never silently drops a placeholder.
const TOKEN_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;

export function interpolateTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return String(template).replace(TOKEN_RE, (whole, name: string) => {
    const v = values[name];
    return v !== undefined && v !== "" ? v : whole;
  });
}

export interface ChatOptions {
  tone?: string | null;
  length?: string | null;
}

export interface AppliedChat {
  systemPrompt: string;
  maxTokens: number;
  // The tone instruction actually applied. null when a preset overrode it (the
  // preset's system_prompt_template is authoritative).
  toneApplied: string | null;
  presetApplied: boolean;
}

function defaultSystemPrompt(tone: string): string {
  return (
    "You are a professional writing assistant for a content management " +
    "system. Write in a " +
    tone +
    " tone."
  );
}

export function applyChatPreset(args: {
  preset: PresetRow | null;
  options?: ChatOptions | null;
  variables?: Record<string, string>;
}): AppliedChat {
  const options = args.options ?? {};
  const variables = args.variables ?? {};
  const maxTokens = lengthToMaxTokens(options.length);

  const systemTemplate =
    args.preset && typeof args.preset.system_prompt_template === "string"
      ? args.preset.system_prompt_template.trim()
      : "";

  if (args.preset && systemTemplate !== "") {
    // AC1: a selected preset's system_prompt_template OVERRIDES the requested
    // tone — options.tone is dropped (toneApplied=null).
    return {
      systemPrompt: interpolateTemplate(systemTemplate, variables),
      maxTokens,
      toneApplied: null,
      presetApplied: true,
    };
  }

  // AC1: no preset -> per-action default system prompt built from the tone.
  const tone =
    typeof options.tone === "string" && options.tone.trim() !== ""
      ? options.tone.trim()
      : DEFAULT_TONE;
  return {
    systemPrompt: defaultSystemPrompt(tone),
    maxTokens,
    toneApplied: tone,
    presetApplied: false,
  };
}
