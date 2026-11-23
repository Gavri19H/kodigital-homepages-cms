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
import { containsPlaceholder, resolveSiteAudience } from "../site-audience";

// T40 [BCL-077]: provisioning generation is preset-governed. Every automatic
// AI step during site setup resolves + fully applies its system preset by
// TASK KEY — the `category` value migration 0020 seeds one is_system default
// per provisioning task. Editing any of these presets through the admin AI
// Presets UI changes the produced content on the next setup. The keys below
// are the single source of truth shared by the provisioning steps (steps.ts)
// and the generators that resolve them (text.ts / image.ts).
export const PROVISIONING_PRESET_CATEGORIES = {
  // generate_15_homepage_articles → the starter-article PLAN (which articles
  // the new site gets) is governed by this preset. Editing it changes the
  // titles/topics the next provisioning run produces.
  starterArticles: "starter-articles",
  tagline: "tagline",
  siteDescription: "site-description",
  logo: "logo",
  heroImage: "hero-image",
  featureImage: "feature-image",
} as const;

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

// X06 (SEO Fixes): the shared "fill or refuse" step every AI text request goes
// through (runTextGenerator in text.ts) before the AI is asked. The AI Presets
// preview never calls this, so it keeps showing tokens unchanged.
//
// Order: the caller's own values (brand_name, vertical, audience, title, …),
// then — only when a token is still left — the site's saved values (Site Name,
// domain, Vertical, audience via resolveSiteAudience). Whatever is still
// unfilled is returned in `missing`; the caller must not send the prompt.
//
// Same token shape as the preset engine's interpolate(): {{name}} with
// optional spaces. Plain JSON braces in a prompt ({"a":{"b":1}}) are not tokens
// and never block a request.
const ANY_TOKEN_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;

export function listUnfilledTokens(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(ANY_TOKEN_RE)) if (m[1]) names.add(m[1]);
  return [...names];
}

function fillTokens(text: string, values: Record<string, string | undefined>): string {
  return text.replace(ANY_TOKEN_RE, (whole, key: string) => {
    const v = values[key];
    return typeof v === "string" && v.trim().length > 0 && !containsPlaceholder(v) ? v : whole;
  });
}

async function loadSiteTokenValues(
  db: D1Database,
  siteId: string,
): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  try {
    const site = await db
      .prepare("SELECT name, domain, vertical_slug FROM sites WHERE id = ? LIMIT 1")
      .bind(siteId)
      .first<{ name: string | null; domain: string | null; vertical_slug: string | null }>();
    if (site) {
      out.brand_name = site.name ?? undefined;
      out.domain = site.domain ?? undefined;
      out.vertical = site.vertical_slug ?? undefined;
    }
  } catch {
    // no site values — the token stays unfilled and is reported
  }
  out.audience = await resolveSiteAudience(db, siteId);
  return out;
}

export async function fillPromptTokens(
  db: D1Database,
  prompt: string,
  known: Record<string, string | undefined>,
  siteId: string | null | undefined,
): Promise<{ prompt: string; missing: string[] }> {
  let out = fillTokens(prompt, known);
  if (listUnfilledTokens(out).length > 0 && typeof siteId === "string" && siteId) {
    out = fillTokens(out, await loadSiteTokenValues(db, siteId));
  }
  return { prompt: out, missing: listUnfilledTokens(out) };
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
