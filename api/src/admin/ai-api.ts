// Admin AI endpoints.
//
// T18 [E1]: POST /api/admin/ai/chat is the REAL admin chat endpoint. It
// calls OpenAI chat completions through createOpenAIClient (model from the
// SUPPORTED_TEXT_MODELS registry) and writes an ai_generations receipt row
// (pending -> success/failed) around every call. When OPENAI_API_KEY is NOT
// set it responds 501 with a JSON error (per the proposal's rejected
// alternative: do NOT silently 200 a fake response).
//
// T19 [E2]: POST /api/admin/ai/image is the REAL admin image endpoint
// (handler in ./ai-image). It generates via OpenAI images (model from the
// SUPPORTED_IMAGE_MODELS registry), PUTs the bytes to R2, inserts a media
// row, and writes an ai_generations receipt row. The route is wrapped in
// hono's bodyLimit — prompt JSON only, never image payloads.
//
// T20 [E3]: POST /api/admin/ai/logo is the REAL admin logo endpoint
// (handler in ./ai-logo). It reuses the T8 logo generator
// (generateLogoImage) and writes the resulting media id to
// site_settings.logo_media_id for the posted site_id only.
//
// T21 [E4]: presets CRUD — the 6 legacy route patterns
// (GET/POST /api/admin/ai/presets, GET/PUT/DELETE /api/admin/ai/presets/:id,
// POST /api/admin/ai/presets/:id/use). Handlers in ./ai-presets (reads) and
// ./ai-presets-write (writes); POST/PUT reject models outside the
// SUPPORTED_*_MODELS registry lists with 400.

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Env } from "../env";
import { getTextModel } from "../ai/models";
import { createOpenAIClient } from "../ai/openai-client";
import {
  finishGenerationLogFailure,
  finishGenerationLogSuccess,
  startGenerationLog,
} from "../ai/generation-log";
import { handleAdminAiImage, IMAGE_BODY_LIMIT_BYTES } from "./ai-image";
import { handleAdminAiLogo } from "./ai-logo";
import { generateFullArticle } from "./ai-article";
import {
  getPreset,
  isValidPresetId,
  listPresets,
  SELECT_PRESET_BY_ID,
  usePreset,
  type PresetRow,
} from "./ai-presets";
import { createPreset, deletePreset, updatePreset } from "./ai-presets-write";
import { applyChatPreset, type ChatOptions } from "./ai-chat-preset";

interface ChatBody {
  prompt?: string;
  site_id?: string | null;
  // T7 [BCL-032]: structured, preset-driven chat. The panel posts the chosen
  // preset, the tone/length options, the {{variable}} values, and optional
  // per-action context. The server applies them (preset system prompt + tone
  // override + length->max_tokens) instead of reading only body.prompt.
  presetId?: number | string | null;
  options?: ChatOptions | null;
  variables?: Record<string, unknown> | null;
  context?: Record<string, unknown> | null;
  // Writer-side per-generation overrides (A3 settable system prompt + the
  // panel's placements). Optional + additive: absent fields change nothing.
  system_prompt?: string | null;
  content_mapping?: Record<string, unknown> | string | null;
}

// Coerce the posted variables (and the lower-priority per-action context) into
// a flat string map for {{token}} interpolation. Nested objects / null are
// skipped; explicit `variables` win over `context`.
function coerceStringMap(
  variables: Record<string, unknown> | null | undefined,
  context: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  const merge = (src: Record<string, unknown> | null | undefined) => {
    if (!src || typeof src !== "object") return;
    for (const [k, v] of Object.entries(src)) {
      if (v === undefined || v === null || typeof v === "object") continue;
      out[k] = String(v);
    }
  };
  merge(context);
  merge(variables);
  return out;
}

const CHAT_TASK = "admin-chat";
const CHAT_PROMPT_VERSION = "v1";

function newChatId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const aiApi = new Hono<{ Bindings: Env }>();

aiApi.post("/api/admin/ai/chat", async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.json({ error: "OPENAI_API_KEY is not configured" }, 501);
  }
  let body: ChatBody = {};
  try {
    body = await c.req.json<ChatBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  const site_id =
    typeof body.site_id === "string" && body.site_id !== "" ? body.site_id : null;

  // T7 [BCL-032]: load the selected preset (if any) then resolve the system
  // prompt + max_tokens budget. A presetId that is malformed -> 400; one that
  // resolves to no row -> 404 (the panel sent a preset that no longer exists);
  // absent presetId -> the per-action default.
  let preset: PresetRow | null = null;
  const presetIdRaw =
    body.presetId === undefined || body.presetId === null
      ? ""
      : String(body.presetId).trim();
  if (presetIdRaw !== "") {
    if (!isValidPresetId(presetIdRaw)) {
      return c.json({ error: "Invalid preset ID" }, 400);
    }
    preset = await c.env.DB.prepare(SELECT_PRESET_BY_ID)
      .bind(presetIdRaw)
      .first<PresetRow>();
    if (!preset) return c.json({ error: "Preset not found" }, 404);
  }

  // A3 + placements overrides: bounded, typed, logged. system_prompt is
  // capped (a runaway payload must not balloon the model call); the mapping
  // accepts the panel's object (stringified for the engine) or a JSON string.
  const systemPromptOverride =
    typeof body.system_prompt === "string" && body.system_prompt.trim() !== ""
      ? body.system_prompt.slice(0, 8000)
      : null;
  let contentMappingOverride: string | null = null;
  if (typeof body.content_mapping === "string" && body.content_mapping.trim() !== "") {
    contentMappingOverride = body.content_mapping.slice(0, 8000);
  } else if (
    body.content_mapping !== null &&
    body.content_mapping !== undefined &&
    typeof body.content_mapping === "object"
  ) {
    contentMappingOverride = JSON.stringify(body.content_mapping).slice(0, 8000);
  }

  // Site-derived context: {{brand_name}} / {{vertical}} resolve automatically
  // from the article's site so writers never fill machine tokens by hand.
  // Client-sent values win; these are fallbacks.
  const chatVariables = coerceStringMap(body.variables, body.context);
  if (site_id !== null && (!chatVariables.brand_name || !chatVariables.vertical)) {
    try {
      const siteRow = await c.env.DB.prepare(
        "SELECT name, vertical_slug FROM sites WHERE id = ? LIMIT 1",
      )
        .bind(site_id)
        .first<{ name: string; vertical_slug: string }>();
      if (siteRow) {
        if (!chatVariables.brand_name && siteRow.name) chatVariables.brand_name = siteRow.name;
        if (!chatVariables.vertical && siteRow.vertical_slug) chatVariables.vertical = siteRow.vertical_slug;
      }
    } catch {
      // Context enrichment is best-effort; a lookup failure never blocks chat.
    }
  }

  const applied = applyChatPreset({
    preset,
    options: body.options ?? null,
    variables: chatVariables,
    overrides: {
      systemPrompt: systemPromptOverride,
      contentMapping: contentMappingOverride,
    },
  });

  let model: string;
  try {
    model = getTextModel(c.env);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500,
    );
  }

  // Receipt row: every chat call gets a fresh ai_generations row keyed by a
  // per-request idempotency_key (interactive chat is never replayed).
  const ai_generation_id = newChatId();
  const idempotency_key = `${CHAT_TASK}:${ai_generation_id}`;
  await startGenerationLog(c.env, {
    id: ai_generation_id,
    site_id,
    task: CHAT_TASK,
    model,
    prompt_version: CHAT_PROMPT_VERSION,
    idempotency_key,
    provider: "openai",
    request_json: {
      prompt,
      preset_id: preset ? preset.id : null,
      tone: applied.toneApplied,
      length: typeof body.options?.length === "string" ? body.options.length : null,
      max_tokens: applied.maxTokens,
      system_prompt: applied.systemPrompt,
      system_prompt_override: systemPromptOverride,
      content_mapping_override: contentMappingOverride,
    },
    target_type: null,
    target_id: null,
  });

  const client = createOpenAIClient(c.env);
  try {
    const result = await client.generateText({
      prompt,
      systemPrompt: applied.systemPrompt,
      maxTokens: applied.maxTokens,
    });
    if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
      // Unreachable (key presence checked above) but type-required; keep the
      // 501 contract rather than inventing a fake success.
      return c.json({ error: "OPENAI_API_KEY is not configured" }, 501);
    }
    await finishGenerationLogSuccess(c.env, {
      idempotency_key,
      response_json: { text: result.text, model: result.model },
      parsed_json: { text: result.text },
    });
    return c.json({
      ok: true,
      model: result.model,
      text: result.text,
      ai_generation_id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishGenerationLogFailure(c.env, {
      idempotency_key,
      error_message: message,
    });
    return c.json({ error: "AI chat request failed", ai_generation_id }, 502);
  }
});

aiApi.post(
  "/api/admin/ai/image",
  bodyLimit({ maxSize: IMAGE_BODY_LIMIT_BYTES }),
  handleAdminAiImage,
);

aiApi.post(
  "/api/admin/ai/logo",
  bodyLimit({ maxSize: IMAGE_BODY_LIMIT_BYTES }),
  handleAdminAiLogo,
);

// The writer's one-click full article (pipeline-parity composer, no INSERT).
aiApi.post("/api/admin/ai/article", generateFullArticle);

// T21 [E4]: presets CRUD route patterns (6).
aiApi.get("/api/admin/ai/presets", listPresets);
aiApi.post("/api/admin/ai/presets", createPreset);
aiApi.get("/api/admin/ai/presets/:id", getPreset);
aiApi.put("/api/admin/ai/presets/:id", updatePreset);
aiApi.delete("/api/admin/ai/presets/:id", deletePreset);
aiApi.post("/api/admin/ai/presets/:id/use", usePreset);

export default aiApi;
