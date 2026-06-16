// T21 [E4]: presets write handlers (create/update/delete) for
// /api/admin/ai/presets*. Shared contract (row/body types, model
// validation, id guard) lives in ./ai-presets. POST and PUT validate
// text_model/image_model against the SUPPORTED registry lists and reject
// unsupported ids with 400; create defaults missing models to the registry
// defaults — no model id literal appears in this file.

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TEXT_MODEL,
} from "../ai/models";
import {
  isValidPresetId,
  modelValidationError,
  normModel,
  SELECT_PRESET_BY_ID,
  type PresetBody,
  type PresetCtx,
  type PresetRow,
} from "./ai-presets";

// Trims a string field to its content, or null when absent/blank. Used for
// the nullable reference columns (name/description/prompts) so a blank field
// is stored as NULL rather than "".
function trimToNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t === "" ? null : t;
}

// POST /api/admin/ai/presets
export async function createPreset(c: PresetCtx) {
  let body: PresetBody;
  try {
    body = await c.req.json<PresetBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) return c.json({ error: "slug is required" }, 400);
  // The reference form (T12) splits the prompt into System + User. The User
  // Prompt is the canonical template; legacy callers may still send a flat
  // prompt_template. prompt_template stays NOT NULL (migration 0001), so it is
  // derived from the User Prompt when not sent explicitly.
  const systemPrompt = trimToNull(body.system_prompt_template);
  const userPrompt = trimToNull(body.user_prompt_template);
  const prompt_template =
    typeof body.prompt_template === "string" && body.prompt_template.trim() !== ""
      ? body.prompt_template.trim()
      : (userPrompt ?? "");
  if (!prompt_template) {
    return c.json({
      error: "prompt_template (or user_prompt_template) is required",
    }, 400);
  }

  const text_model = normModel(body.text_model);
  const image_model = normModel(body.image_model);
  const modelError = modelValidationError(text_model, image_model);
  if (modelError) return c.json({ error: modelError }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT id FROM prompt_presets WHERE slug = ?",
  )
    .bind(slug)
    .first();
  if (existing) {
    return c.json({ error: "A preset with this slug already exists" }, 409);
  }

  const result = await c.env.DB.prepare(
    "INSERT INTO prompt_presets (slug, prompt_template, category, variables, text_model, image_model, is_system, is_active, name, description, system_prompt_template, user_prompt_template, content_mapping) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      slug,
      prompt_template,
      body.category ?? null,
      body.variables ?? null,
      text_model ?? DEFAULT_TEXT_MODEL,
      image_model ?? DEFAULT_IMAGE_MODEL,
      body.is_system === 1 ? 1 : 0,
      body.is_active === 0 ? 0 : 1,
      trimToNull(body.name),
      trimToNull(body.description),
      systemPrompt,
      userPrompt,
      body.content_mapping ?? null,
    )
    .run();

  const preset = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
    .bind(result.meta.last_row_id)
    .first<PresetRow>();
  return c.json({ item: preset }, 201);
}

// PUT /api/admin/ai/presets/:id — partial update. System presets only allow
// the is_active toggle (legacy parity).
export async function updatePreset(c: PresetCtx) {
  const id = c.req.param("id") ?? "";
  if (!isValidPresetId(id)) return c.json({ error: "Invalid preset ID" }, 400);
  const existing = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
    .bind(id)
    .first<PresetRow>();
  if (!existing) return c.json({ error: "Preset not found" }, 404);

  let body: PresetBody;
  try {
    body = await c.req.json<PresetBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (existing.is_system === 1) {
    if (body.is_active !== undefined) {
      await c.env.DB.prepare(
        "UPDATE prompt_presets SET is_active = ? WHERE id = ?",
      )
        .bind(body.is_active === 0 ? 0 : 1, id)
        .run();
      const preset = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
        .bind(id)
        .first<PresetRow>();
      return c.json({ item: preset });
    }
    return c.json({ error: "Cannot edit system presets" }, 403);
  }

  const text_model = normModel(body.text_model);
  const image_model = normModel(body.image_model);
  const modelError = modelValidationError(text_model, image_model);
  if (modelError) return c.json({ error: modelError }, 400);

  const newSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (newSlug && newSlug !== existing.slug) {
    const slugExists = await c.env.DB.prepare(
      "SELECT id FROM prompt_presets WHERE slug = ? AND id != ?",
    )
      .bind(newSlug, id)
      .first();
    if (slugExists) {
      return c.json({ error: "A preset with this slug already exists" }, 409);
    }
  }

  // Edit keeps prompt_template synced to the User Prompt: an explicit
  // prompt_template wins, otherwise the User Prompt (if sent) flows through.
  const newUserPrompt = trimToNull(body.user_prompt_template);
  const newPromptTemplate =
    typeof body.prompt_template === "string" && body.prompt_template.trim() !== ""
      ? body.prompt_template.trim()
      : newUserPrompt;
  await c.env.DB.prepare(
    "UPDATE prompt_presets SET slug = COALESCE(?, slug), prompt_template = COALESCE(?, prompt_template), category = COALESCE(?, category), variables = COALESCE(?, variables), text_model = COALESCE(?, text_model), image_model = COALESCE(?, image_model), is_active = COALESCE(?, is_active), name = COALESCE(?, name), description = COALESCE(?, description), system_prompt_template = COALESCE(?, system_prompt_template), user_prompt_template = COALESCE(?, user_prompt_template), content_mapping = COALESCE(?, content_mapping) WHERE id = ?",
  )
    .bind(
      newSlug !== "" ? newSlug : null,
      newPromptTemplate,
      body.category ?? null,
      body.variables ?? null,
      text_model ?? null,
      image_model ?? null,
      body.is_active !== undefined ? (body.is_active === 0 ? 0 : 1) : null,
      trimToNull(body.name),
      trimToNull(body.description),
      trimToNull(body.system_prompt_template),
      newUserPrompt,
      body.content_mapping ?? null,
      id,
    )
    .run();

  const preset = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
    .bind(id)
    .first<PresetRow>();
  return c.json({ item: preset });
}

// DELETE /api/admin/ai/presets/:id — system presets are protected.
export async function deletePreset(c: PresetCtx) {
  const id = c.req.param("id") ?? "";
  if (!isValidPresetId(id)) return c.json({ error: "Invalid preset ID" }, 400);
  const existing = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
    .bind(id)
    .first<PresetRow>();
  if (!existing) return c.json({ error: "Preset not found" }, 404);
  if (existing.is_system === 1) {
    return c.json({ error: "Cannot delete system presets" }, 403);
  }
  await c.env.DB.prepare("DELETE FROM prompt_presets WHERE id = ?")
    .bind(id)
    .run();
  return c.body(null, 204);
}
