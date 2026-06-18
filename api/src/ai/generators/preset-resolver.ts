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
//
// T9 [BCL-041]: the effective prompt is now produced by the single preset
// engine (applyPreset), so the provisioning path applies all seven preset
// categories — Custom Variables, Output Rules, Content Preset Mapping and
// image options — not just the combined system+user prompt + model. The
// resolver SELECTs the structured columns and hands the row to applyPreset;
// the editor /chat path delegates to the same engine, so editing any part of
// a preset changes generation everywhere.

import type { Env } from "../../env";
import type { SupportedTextModel } from "../models";
import { applyPreset } from "./preset-engine";

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
  // T9: the structured categories the engine folds into the effective prompt.
  content_mapping: string | null;
  output_rules: string | null;
  variables_schema: string | null;
}

// FIXED literal SQL (file convention: no template-literal SQL). The category
// value is bound, never interpolated. is_system DESC prefers the seeded
// default; usage_count DESC then id ASC make the pick deterministic.
// T9: content_mapping / output_rules / variables_schema are selected so the
// engine applies all seven categories, not just the combined prompt + model.
const SELECT_ACTIVE_PRESET_BY_CATEGORY =
  "SELECT id, slug, prompt_template, system_prompt_template, " +
  "user_prompt_template, text_model, content_mapping, output_rules, " +
  "variables_schema FROM prompt_presets " +
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

  // T9: the single engine builds the effective prompt — system + user prompt
  // with the structured Output Rules / Content Mapping / image directives
  // folded in, and the variables_schema defaults applied under the caller
  // vars. A preset row with no usable prompt text (no system/user/flat
  // template) resolves to null so the caller keeps the builder prompt rather
  // than sending a directives-only prompt with no instruction.
  const applied = applyPreset({ preset: row, variables: nonEmpty(vars) });
  const hasPromptText =
    (row.system_prompt_template ?? "").trim().length > 0 ||
    (row.user_prompt_template ?? "").trim().length > 0 ||
    (row.prompt_template ?? "").trim().length > 0;
  if (!hasPromptText) return null;

  return {
    prompt: applied.effectivePrompt,
    model: applied.model,
    preset_id: row.id,
    slug: row.slug,
  };
}

// The engine's variable map is Record<string,string>; drop undefined entries
// from the caller's optional-valued context before handing it to applyPreset.
function nonEmpty(
  vars: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}
