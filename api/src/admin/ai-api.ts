// Admin AI placeholder endpoints.
//
// T10.AC2: when OPENAI_API_KEY is NOT set, both endpoints respond 501 with
// a JSON error so consumers know the wiring is deferred (per the proposal's
// rejected alternative: do NOT silently 200 a fake response). When the key
// IS set, Phase 1 returns a 200 placeholder shaped like the eventual real
// response so downstream integrations can be coded against the contract;
// the actual OpenAI provisioning happens in a later phase.

import { Hono } from "hono";
import type { Env } from "../env";

interface GenerateTextBody {
  prompt?: string;
  preset?: string;
}

interface GenerateImageBody {
  prompt?: string;
  size?: string;
}

const aiApi = new Hono<{ Bindings: Env }>();

aiApi.post("/api/admin/ai/generate-text", async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.json(
      { error: "OPENAI_API_KEY is not configured", phase: "1-deferred" },
      501,
    );
  }
  let body: GenerateTextBody = {};
  try {
    body = await c.req.json<GenerateTextBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  return c.json({
    ok: true,
    model: c.env.OPENAI_TEXT_MODEL,
    placeholder: true,
    text: "",
  });
});

aiApi.post("/api/admin/ai/generate-image", async (c) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.json(
      { error: "OPENAI_API_KEY is not configured", phase: "1-deferred" },
      501,
    );
  }
  let body: GenerateImageBody = {};
  try {
    body = await c.req.json<GenerateImageBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) return c.json({ error: "prompt is required" }, 400);
  return c.json({
    ok: true,
    model: c.env.OPENAI_IMAGE_MODEL,
    placeholder: true,
    image_url: null,
  });
});

export default aiApi;
