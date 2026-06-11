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

interface ChatBody {
  prompt?: string;
  site_id?: string | null;
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
    request_json: { prompt },
    target_type: null,
    target_id: null,
  });

  const client = createOpenAIClient(c.env);
  try {
    const result = await client.generateText({ prompt });
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

export default aiApi;
