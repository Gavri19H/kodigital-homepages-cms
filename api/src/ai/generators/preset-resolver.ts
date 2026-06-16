// T13: presets drive generation. Given a use-case `category`, resolve the
// active prompt_presets row for that category and return its effective prompt
// + model so generation reads the seeded presets (migration 0016) instead of
// only the hard-coded prompt builders.
//
// Contract (T13-AC1): generateStarterArticlePlan ('outline') and
// generateStarterArticle ('content') call this. When a preset exists the
// generator uses the preset's prompt and model; with no preset (or a DB
// error / an empty-prompt row) the resolver returns null and the caller falls
// back to the existing deterministic builder — no crash, no stub.

import type { Env } from "../../env";
import { SUPPORTED_TEXT_MODELS, type SupportedTextModel } from "../models";

export interface ResolvedPreset {
  // The effective prompt: the split System/User prompt (reference form,
  // migration 0014) joined with a blank line, else the flat prompt_template.
  // Interpolated against the caller-supplied variables.
  prompt: string;
  // The preset's text_model when it is a SUPPORTED_TEXT_MODELS id, else null
  // (null = the caller keeps the registry default).
  model: SupportedTextModel | null;
  preset_id: number;
  slug: string;
}

interface PresetLookupRow {
  id: number;
  slug: string;
  prompt_template: string | null;
  system_prompt_template: string | null;
  user_prompt_template: string | null;
  text_model: string | null;
}

// FIXED literal SQL (file convention: no template-literal SQL). The category
// value is bound, never interpolated. is_system DESC prefers the seeded
// default; usage_count DESC then id ASC make the pick deterministic.
const SELECT_ACTIVE_PRESET_BY_CATEGORY =
  "SELECT id, slug, prompt_template, system_prompt_template, " +
  "user_prompt_template, text_model FROM prompt_presets " +
  "WHERE category = ? AND is_active = 1 " +
  "ORDER BY is_system DESC, usage_count DESC, id ASC LIMIT 1";

// Replaces {{key}} tokens with the matching context value. Unknown tokens are
// left intact so a preset that references a variable the caller does not
// supply still yields a usable prompt (never throws).
export function interpolatePreset(
  template: string,
  vars: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, key: string) => {
    const value = vars[key];
    return typeof value === "string" && value.length > 0 ? value : whole;
  });
}

export async function resolveCategoryPreset(
  env: Env,
  category: string,
  vars: Record<string, string | undefined>,
): Promise<ResolvedPreset | null> {
  let row: PresetLookupRow | null = null;
  try {
    row = await env.DB.prepare(SELECT_ACTIVE_PRESET_BY_CATEGORY)
      .bind(category)
      .first<PresetLookupRow>();
  } catch {
    // No prompt_presets table / DB error → behave as "no preset" so the
    // caller falls back to the deterministic builder (no crash).
    return null;
  }
  if (!row) return null;

  const sys = (row.system_prompt_template ?? "").trim();
  const usr = (row.user_prompt_template ?? "").trim();
  const flat = (row.prompt_template ?? "").trim();
  const combined = sys || usr ? [sys, usr].filter((p) => p.length > 0).join("\n\n") : flat;
  // A preset row with no usable prompt text resolves to null so the caller
  // keeps the builder prompt rather than sending an empty prompt to the model.
  if (combined.length === 0) return null;

  const model =
    typeof row.text_model === "string" &&
    (SUPPORTED_TEXT_MODELS as readonly string[]).includes(row.text_model)
      ? (row.text_model as SupportedTextModel)
      : null;

  return {
    prompt: interpolatePreset(combined, vars),
    model,
    preset_id: row.id,
    slug: row.slug,
  };
}
