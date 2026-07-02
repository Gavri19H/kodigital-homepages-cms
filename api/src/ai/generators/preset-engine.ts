// T9 [BCL-041]: the single preset-application engine.
//
// Before this story two code paths applied presets differently: the editor
// /chat path (ai-chat-preset) applied system_prompt + tone-override + length,
// and the provisioning resolver (preset-resolver) applied only the combined
// system+user prompt + model — 2 of the 7 configurable categories. The
// structured categories the operator can configure (Custom Variables, Output
// Rules, Content Preset Mapping, image options) were silently dropped during
// generation.
//
// applyPreset is the SINGLE control surface both consumers now call: it folds
// ALL seven categories into the prompt the model receives, so editing any part
// of a preset changes the output everywhere generation happens. Folding is
// additive — a preset whose structured fields are empty produces exactly the
// same prompt the legacy combined-prompt path produced (backward compatible).

import { SUPPORTED_TEXT_MODELS, type SupportedTextModel } from "../models";

// The seven configurable preset categories. AC1: the engine applies all of
// these, not the legacy 2 (combined prompt + model).
export const PRESET_CATEGORIES = [
  "system_prompt",
  "user_prompt",
  "model",
  "content_mapping",
  "output_rules",
  "variables",
  "image_options",
] as const;
export type PresetCategory = (typeof PRESET_CATEGORIES)[number];

// Structural subset of prompt_presets the engine reads. Both PresetRow
// (admin/ai-presets) and the resolver's PresetLookupRow satisfy it, so the
// engine never couples to the admin layer.
export interface EnginePreset {
  prompt_template?: string | null;
  system_prompt_template?: string | null;
  user_prompt_template?: string | null;
  text_model?: string | null;
  content_mapping?: string | null;
  output_rules?: string | null;
  variables_schema?: string | null;
}

export interface AppliedPreset {
  // Chat-facing system message: the interpolated system prompt with the
  // structured directives folded in (so the editor reflects rule edits).
  systemPrompt: string;
  // Interpolated user prompt (the provisioning user instruction).
  userPrompt: string;
  // Provisioning-facing single prompt: system + user + directives.
  effectivePrompt: string;
  // The preset's text_model when it is a SUPPORTED_TEXT_MODELS id, else null.
  model: SupportedTextModel | null;
  // The structured-rule directive block folded into the prompt ("" when none).
  directives: string;
  contentMapping: Record<string, unknown> | null;
  outputRules: unknown[];
  // Caller variables merged over the variables_schema declared defaults.
  variables: Record<string, string>;
  imageOptions: Record<string, string> | null;
  // Which of the seven categories actually contributed to the prompt.
  appliedCategories: PresetCategory[];
  presetApplied: boolean;
}

// {{token}} interpolation. Unknown / empty tokens are left verbatim so a
// half-filled preview never silently drops a placeholder.
const TOKEN_RE = /\{\{\s*([\w.\-]+)\s*\}\}/g;
export function interpolate(
  template: string,
  values: Record<string, string>,
): string {
  return String(template).replace(TOKEN_RE, (whole, name: string) => {
    const v = values[name];
    return v !== undefined && v !== "" ? v : whole;
  });
}

// JSON.parse with a dedicated try/catch (D1 safety): corrupt/absent text reads
// back as the empty shape so the engine never throws on a bad row.
function parseJsonArray(raw: string | null | undefined): unknown[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface VariableSpec {
  key?: string;
  default?: string;
}

// Merge caller variables OVER the schema-declared defaults: a declared default
// fills a variable the caller did not supply. `applied` is true when the
// schema declares at least one variable (the "variables" category is present).
function resolveVariables(
  schema: unknown[],
  caller: Record<string, string>,
): { merged: Record<string, string>; applied: boolean } {
  const merged: Record<string, string> = { ...caller };
  let applied = false;
  for (const entry of schema) {
    if (!entry || typeof entry !== "object") continue;
    const spec = entry as VariableSpec;
    if (typeof spec.key !== "string" || spec.key === "") continue;
    applied = true;
    if (
      (merged[spec.key] === undefined || merged[spec.key] === "") &&
      typeof spec.default === "string" &&
      spec.default !== ""
    ) {
      merged[spec.key] = spec.default;
    }
  }
  return { merged, applied };
}

// Render the output_rules array (paragraph_type/min/max/style/json_schema or a
// free-text rule) into a deterministic directive block.
function renderOutputRules(rules: unknown[]): string {
  const lines: string[] = [];
  for (const r of rules) {
    if (typeof r === "string" && r.trim() !== "") {
      lines.push("- " + r.trim());
      continue;
    }
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof o.paragraph_type === "string" && o.paragraph_type)
      parts.push("paragraph type " + o.paragraph_type);
    if (typeof o.min === "number") parts.push("min " + o.min);
    if (typeof o.max === "number") parts.push("max " + o.max);
    if (typeof o.style === "string" && o.style) parts.push("style " + o.style);
    if (typeof o.json_schema === "string" && o.json_schema)
      parts.push("conform to JSON schema: " + o.json_schema);
    if (parts.length) lines.push("- " + parts.join(", "));
  }
  return lines.length ? "Output rules:\n" + lines.join("\n") : "";
}

interface ContentMappingRender {
  directive: string;
  imageOptions: Record<string, string> | null;
  hasContentConfig: boolean;
}

// Split content_mapping into the content-field directive (enabled fields,
// paragraph_count, JSON-schema enforcement) and the image options (the
// hero_image/above_subheadline_image prompts that live under image_prompts).
function renderContentMapping(
  map: Record<string, unknown> | null,
): ContentMappingRender {
  if (!map) return { directive: "", imageOptions: null, hasContentConfig: false };
  const fields: string[] = [];
  let enforceJson = false;
  let paragraphCount: number | null = null;
  let imageOptions: Record<string, string> | null = null;

  for (const [k, v] of Object.entries(map)) {
    if (k === "image_prompts") {
      if (v && typeof v === "object") {
        const im: Record<string, string> = {};
        for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
          if (typeof iv === "string" && iv.trim() !== "") im[ik] = iv;
        }
        if (Object.keys(im).length) imageOptions = im;
      }
      continue;
    }
    if (k === "paragraph_count") {
      if (typeof v === "number") paragraphCount = v;
      continue;
    }
    if (k === "enforce_json_schema" || k === "enforce_json") {
      if (v === true) enforceJson = true;
      continue;
    }
    if (v === true) fields.push(k);
  }

  const lines: string[] = [];
  if (fields.length)
    lines.push("Populate these content fields: " + fields.join(", ") + ".");
  if (paragraphCount !== null) lines.push("Write " + paragraphCount + " paragraphs.");
  if (enforceJson)
    lines.push("Return the result as strict JSON conforming to the declared schema.");

  const hasContentConfig = lines.length > 0;
  return {
    directive: hasContentConfig ? "Content mapping:\n" + lines.join("\n") : "",
    imageOptions,
    hasContentConfig,
  };
}

export interface ApplyPresetArgs {
  preset: EnginePreset | null;
  variables?: Record<string, string>;
}

// The single engine. Returns the fully-resolved generation spec for a preset:
// system/user prompts, model, and the structured directives folded into the
// prompt. Empty structured fields contribute nothing, so the effectivePrompt
// for a prompt-only preset equals the legacy combined-prompt output.
export function applyPreset(args: ApplyPresetArgs): AppliedPreset {
  const callerVars = args.variables ?? {};
  const preset = args.preset;
  if (!preset) {
    return {
      systemPrompt: "",
      userPrompt: "",
      effectivePrompt: "",
      model: null,
      directives: "",
      contentMapping: null,
      outputRules: [],
      variables: { ...callerVars },
      imageOptions: null,
      appliedCategories: [],
      presetApplied: false,
    };
  }

  const { merged: variables, applied: variablesApplied } = resolveVariables(
    parseJsonArray(preset.variables_schema),
    callerVars,
  );

  const sysT = (preset.system_prompt_template ?? "").trim();
  const usrT = (preset.user_prompt_template ?? "").trim();
  const flatT = (preset.prompt_template ?? "").trim();
  const systemBase = sysT ? interpolate(sysT, variables) : "";
  const userBase = usrT ? interpolate(usrT, variables) : "";
  // Flat prompt_template is the user instruction only when neither split
  // template is present (legacy combined-prompt parity).
  const flatBase = !sysT && !usrT && flatT ? interpolate(flatT, variables) : "";

  const outputRules = parseJsonArray(preset.output_rules);
  const contentMapping = parseJsonObject(preset.content_mapping);
  // Free-text rules are templates too: interpolate {{tokens}} with the same
  // variables the prompt templates get (0030 moved token-bearing contract
  // text into output_rules; without this the model would see literal tokens).
  const outputRulesDirective = renderOutputRules(
    outputRules.map((r) => (typeof r === "string" ? interpolate(r, variables) : r)),
  );
  const cm = renderContentMapping(contentMapping);
  const imageDirective = cm.imageOptions
    ? "Image prompts:\n" +
      Object.entries(cm.imageOptions)
        .map(([ik, iv]) => "- " + ik + ": " + iv)
        .join("\n")
    : "";

  const directives = [outputRulesDirective, cm.directive, imageDirective]
    .filter((s) => s !== "")
    .join("\n\n");

  const model =
    typeof preset.text_model === "string" &&
    (SUPPORTED_TEXT_MODELS as readonly string[]).includes(preset.text_model)
      ? (preset.text_model as SupportedTextModel)
      : null;

  const systemPrompt = [systemBase, directives]
    .filter((s) => s !== "")
    .join("\n\n");
  const userPrompt = userBase || flatBase;
  const effectivePrompt = [systemBase, userBase || flatBase, directives]
    .filter((s) => s !== "")
    .join("\n\n");

  const appliedCategories: PresetCategory[] = [];
  if (sysT) appliedCategories.push("system_prompt");
  if (usrT || flatT) appliedCategories.push("user_prompt");
  if (model) appliedCategories.push("model");
  if (cm.hasContentConfig) appliedCategories.push("content_mapping");
  if (outputRulesDirective !== "") appliedCategories.push("output_rules");
  if (variablesApplied) appliedCategories.push("variables");
  if (cm.imageOptions) appliedCategories.push("image_options");

  return {
    systemPrompt,
    userPrompt,
    effectivePrompt,
    model,
    directives,
    contentMapping,
    outputRules,
    variables,
    imageOptions: cm.imageOptions,
    appliedCategories,
    presetApplied: true,
  };
}
