import type { Env } from "../../env";
import { getImageModel, getTextModel } from "../models";
import {
  createOpenAIClient,
  type GenerateImageResult,
  type OpenAIClient,
} from "../openai-client";
import {
  finishGenerationLogFailure,
  finishGenerationLogFallback,
  finishGenerationLogSuccess,
  getGenerationByIdempotencyKey,
  redactSecretsFromPayload,
  startGenerationLog,
  type AiGenerationRow,
} from "../generation-log";
import {
  PROMPT_VERSION as LOGO_PROMPT_VERSION,
  buildPrompt as buildLogoPrompt,
  type BuildLogoPromptInput,
} from "../prompts/logo";
import {
  PROMPT_VERSION as FEATURE_PROMPT_VERSION,
  buildPrompt as buildFeatureImagePrompt,
  type BuildFeatureImagePromptInput,
} from "../prompts/feature-image";
import type {
  GeneratedImagePrompt,
  GeneratedMeta,
  GeneratedStatus,
} from "../schemas";
import { computeIdempotencyKey } from "./text";

// T8: Image generators (logo prompt+image, feature-image prompt+image).
//
// Each generator follows the same OPENAI_API_KEY-aware contract as the T7
// text generators:
// - generateLogoPrompt / generateFeatureImagePrompt are deterministic given
//   the same input. They always produce a usable GeneratedImagePrompt and
//   log a row in ai_generations for traceability (status='success' when
//   the key is present, 'skipped_no_api_key' otherwise — the parsed_json
//   carries the same prompt either way so consumers can read it without
//   branching on status).
// - generateLogoImage / generateFeatureImage call client.generateImage(),
//   upload the bytes to R2 under a DETERMINISTIC storage_key derived from
//   (site_id, target_kind, target_id), insert a media row tagged with
//   both site_id and ai_generation_id, and write the success row to
//   ai_generations. When OPENAI_API_KEY is absent the image is not put to
//   R2 and no media row is inserted — the function returns { status:
//   'skipped_no_api_key', media_id: 0 } so callers can detect the
//   placeholder without dereferencing a non-existent row.
// - Idempotency: a second call with the same idempotency_key reads the
//   existing ai_generations.parsed_json and re-returns { media_id,
//   storage_key } without re-uploading to R2 or re-inserting media.

const LOGO_TASK = "logo-image";
const FEATURE_IMAGE_TASK = "feature-image";
const LOGO_PROMPT_TASK = "logo-prompt";
const FEATURE_IMAGE_PROMPT_TASK = "feature-image-prompt";
const LOGO_SIZE = "1024x1024";
const FEATURE_IMAGE_SIZE = "1792x1024";

export interface GenerateImagePromptResult {
  ai_generation_id: string;
  idempotency_key: string;
  status: GeneratedStatus;
  parsed: GeneratedImagePrompt;
}

export interface GenerateImageOutcome {
  ai_generation_id: string;
  idempotency_key: string;
  status: GeneratedStatus;
  media_id: number;
  storage_key: string;
  prompt: string;
}

interface MediaArtifactRecord {
  media_id: number;
  storage_key: string;
  mime: string;
  size_bytes: number;
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function meta(
  task: string,
  model: string,
  prompt_version: string,
  ai_generation_id: string,
  status: GeneratedStatus,
): GeneratedMeta {
  return { task, model, prompt_version, status, ai_generation_id };
}

export function buildAiStorageKey(opts: {
  site_id: string;
  target_kind: "logo" | "feature_image";
  target_id?: string;
  ext?: string;
}): string {
  const targetId = (opts.target_id ?? "default").replace(/[^A-Za-z0-9_-]+/g, "-");
  const safeSite = opts.site_id.replace(/[^A-Za-z0-9_-]+/g, "-");
  const ext = opts.ext ?? "png";
  return `ai/${safeSite}/${opts.target_kind}/${targetId}.${ext}`;
}

function readMediaArtifactFromRow(
  row: AiGenerationRow | null,
): MediaArtifactRecord | null {
  if (!row?.parsed_json) return null;
  try {
    const parsed = JSON.parse(row.parsed_json) as {
      media_id?: number;
      storage_key?: string;
      mime?: string;
      size_bytes?: number;
    };
    if (
      typeof parsed.media_id === "number" &&
      typeof parsed.storage_key === "string"
    ) {
      return {
        media_id: parsed.media_id,
        storage_key: parsed.storage_key,
        mime: parsed.mime ?? "image/png",
        size_bytes: parsed.size_bytes ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// Prompt generators (deterministic; small ai_generations receipt)
// ============================================================

export interface GenerateLogoPromptInput extends BuildLogoPromptInput {
  client?: OpenAIClient;
}

export async function generateLogoPrompt(
  env: Env,
  input: GenerateLogoPromptInput,
): Promise<GenerateImagePromptResult> {
  return runPromptGenerator({
    env,
    task: LOGO_PROMPT_TASK,
    prompt_version: LOGO_PROMPT_VERSION,
    target_type: "site_settings",
    target_id: input.site_id,
    target_kind: "logo",
    site_id: input.site_id,
    size: LOGO_SIZE,
    prompt: buildLogoPrompt(input),
    client: input.client,
  });
}

export interface GenerateFeatureImagePromptInput
  extends BuildFeatureImagePromptInput {
  client?: OpenAIClient;
  article_slug?: string;
}

export async function generateFeatureImagePrompt(
  env: Env,
  input: GenerateFeatureImagePromptInput,
): Promise<GenerateImagePromptResult> {
  const targetId = input.article_slug ?? input.article_title;
  return runPromptGenerator({
    env,
    task: FEATURE_IMAGE_PROMPT_TASK,
    prompt_version: FEATURE_PROMPT_VERSION,
    target_type: "article_feature_image",
    target_id: targetId,
    target_kind: "feature_image",
    site_id: input.site_id,
    size: FEATURE_IMAGE_SIZE,
    prompt: buildFeatureImagePrompt(input),
    idempotency_suffix: targetId,
    client: input.client,
  });
}

interface RunPromptArgs {
  env: Env;
  task: string;
  prompt_version: string;
  target_type: string | null;
  target_id: string | null;
  target_kind: "logo" | "feature_image";
  site_id: string;
  size: string;
  prompt: string;
  idempotency_suffix?: string;
  client?: OpenAIClient;
}

async function runPromptGenerator(
  args: RunPromptArgs,
): Promise<GenerateImagePromptResult> {
  const idempotency_key = computeIdempotencyKey(
    args.site_id,
    args.task,
    args.prompt_version,
    args.idempotency_suffix ?? args.target_id ?? "",
  );

  const existing = await getGenerationByIdempotencyKey(args.env, idempotency_key);
  if (existing) {
    const parsed = parseStoredPrompt(existing, args);
    return {
      ai_generation_id: existing.id,
      idempotency_key,
      status: existing.status,
      parsed,
    };
  }

  const client = args.client ?? createOpenAIClient(args.env);
  const textModel = getTextModel(args.env);

  const startRow = await startGenerationLog(args.env, {
    id: newId(),
    site_id: args.site_id,
    task: args.task,
    model: textModel,
    prompt_version: args.prompt_version,
    idempotency_key,
    provider: "openai",
    request_json: { prompt: args.prompt, size: args.size },
    target_type: args.target_type,
    target_id: args.target_id,
  });
  const ai_generation_id = startRow.id;
  const status: GeneratedStatus = client.hasApiKey() ? "success" : "skipped_no_api_key";

  const payload: GeneratedImagePrompt = {
    meta: meta(args.task, textModel, args.prompt_version, ai_generation_id, status),
    site_id: args.site_id,
    target_kind: args.target_kind,
    prompt: args.prompt,
    size: args.size,
  };

  if (client.hasApiKey()) {
    await finishGenerationLogSuccess(args.env, {
      idempotency_key,
      response_json: { prompt: args.prompt },
      parsed_json: redactSecretsFromPayload(payload as unknown),
      target_type: args.target_type,
      target_id: args.target_id,
    });
  } else {
    await finishGenerationLogFallback(args.env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(payload as unknown),
      target_type: args.target_type,
      target_id: args.target_id,
      error_message: null,
    });
  }

  return { ai_generation_id, idempotency_key, status, parsed: payload };
}

function parseStoredPrompt(
  row: AiGenerationRow,
  args: RunPromptArgs,
): GeneratedImagePrompt {
  const fallback: GeneratedImagePrompt = {
    meta: meta(args.task, row.model, args.prompt_version, row.id, row.status),
    site_id: args.site_id,
    target_kind: args.target_kind,
    prompt: args.prompt,
    size: args.size,
  };
  if (!row.parsed_json) return fallback;
  try {
    return JSON.parse(row.parsed_json) as GeneratedImagePrompt;
  } catch {
    return fallback;
  }
}

// ============================================================
// Image generators (call OpenAI image model + write R2 + media row)
// ============================================================

export interface GenerateLogoImageInput extends BuildLogoPromptInput {
  client?: OpenAIClient;
}

export async function generateLogoImage(
  env: Env,
  input: GenerateLogoImageInput,
): Promise<GenerateImageOutcome> {
  const prompt = buildLogoPrompt(input);
  return runImageGenerator({
    env,
    task: LOGO_TASK,
    prompt_version: LOGO_PROMPT_VERSION,
    target_type: "site_settings",
    target_id: input.site_id,
    target_kind: "logo",
    site_id: input.site_id,
    size: LOGO_SIZE,
    prompt,
    filename: "logo.png",
    folder: "ai/logo",
    alt_text: `Logo mark for ${input.brand_name ?? input.site_id}`,
    client: input.client,
  });
}

export interface GenerateFeatureImageInput extends BuildFeatureImagePromptInput {
  article_slug: string;
  client?: OpenAIClient;
}

export async function generateFeatureImage(
  env: Env,
  input: GenerateFeatureImageInput,
): Promise<GenerateImageOutcome> {
  const prompt = buildFeatureImagePrompt(input);
  return runImageGenerator({
    env,
    task: FEATURE_IMAGE_TASK,
    prompt_version: FEATURE_PROMPT_VERSION,
    target_type: "article_feature_image",
    target_id: input.article_slug,
    target_kind: "feature_image",
    site_id: input.site_id,
    size: FEATURE_IMAGE_SIZE,
    prompt,
    filename: `feature-${input.article_slug}.png`,
    folder: "ai/feature-image",
    alt_text: `Feature image for ${input.article_title}`,
    idempotency_suffix: input.article_slug,
    client: input.client,
  });
}

interface RunImageArgs {
  env: Env;
  task: string;
  prompt_version: string;
  target_type: string | null;
  target_id: string | null;
  target_kind: "logo" | "feature_image";
  site_id: string;
  size: string;
  prompt: string;
  filename: string;
  folder: string;
  alt_text: string;
  idempotency_suffix?: string;
  client?: OpenAIClient;
}

async function runImageGenerator(
  args: RunImageArgs,
): Promise<GenerateImageOutcome> {
  const idempotency_key = computeIdempotencyKey(
    args.site_id,
    args.task,
    args.prompt_version,
    args.idempotency_suffix ?? args.target_id ?? "",
  );

  // Storage key is deterministic — same site_id + target context always
  // yields the same R2 key.
  const storage_key = buildAiStorageKey({
    site_id: args.site_id,
    target_kind: args.target_kind,
    target_id: args.idempotency_suffix ?? args.target_id ?? undefined,
  });

  // Short-circuit on prior idempotent run (no re-upload, no duplicate INSERT INTO media).
  const existing = await getGenerationByIdempotencyKey(args.env, idempotency_key);
  if (existing) {
    const artifact = readMediaArtifactFromRow(existing);
    if (
      existing.status === "success" ||
      existing.status === "fallback" ||
      existing.status === "skipped_no_api_key"
    ) {
      return {
        ai_generation_id: existing.id,
        idempotency_key,
        status: existing.status,
        media_id: artifact?.media_id ?? 0,
        storage_key: artifact?.storage_key ?? storage_key,
        prompt: args.prompt,
      };
    }
  }

  const client = args.client ?? createOpenAIClient(args.env);
  const imageModel = getImageModel(args.env);

  const startRow = await startGenerationLog(args.env, {
    id: existing?.id ?? newId(),
    site_id: args.site_id,
    task: args.task,
    model: imageModel,
    prompt_version: args.prompt_version,
    idempotency_key,
    provider: "openai",
    request_json: { prompt: args.prompt, size: args.size },
    target_type: args.target_type,
    target_id: args.target_id,
  });
  const ai_generation_id = startRow.id;

  // No API key — no R2 PUT, no media row. Return placeholder media_id=0.
  if (!client.hasApiKey()) {
    const payload = {
      media_id: 0,
      storage_key,
      mime: "image/png",
      size_bytes: 0,
      meta: meta(
        args.task,
        imageModel,
        args.prompt_version,
        ai_generation_id,
        "skipped_no_api_key",
      ),
    };
    await finishGenerationLogFallback(args.env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(payload as unknown),
      target_type: args.target_type,
      target_id: args.target_id,
      error_message: null,
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "skipped_no_api_key",
      media_id: 0,
      storage_key,
      prompt: args.prompt,
    };
  }

  let imageResult: GenerateImageResult;
  try {
    imageResult = await client.generateImage({ prompt: args.prompt, size: args.size });
  } catch (err) {
    await finishGenerationLogFailure(args.env, {
      idempotency_key,
      error_message: err instanceof Error ? err.message : String(err),
    });
    const payload = {
      media_id: 0,
      storage_key,
      mime: "image/png",
      size_bytes: 0,
      meta: meta(args.task, imageModel, args.prompt_version, ai_generation_id, "fallback"),
    };
    await finishGenerationLogFallback(args.env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(payload as unknown),
      target_type: args.target_type,
      target_id: args.target_id,
      error_message: err instanceof Error ? err.message : String(err),
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "fallback",
      media_id: 0,
      storage_key,
      prompt: args.prompt,
    };
  }

  if ("skipped_no_api_key" in imageResult && imageResult.skipped_no_api_key) {
    const payload = {
      media_id: 0,
      storage_key,
      mime: "image/png",
      size_bytes: 0,
      meta: meta(
        args.task,
        imageModel,
        args.prompt_version,
        ai_generation_id,
        "skipped_no_api_key",
      ),
    };
    await finishGenerationLogFallback(args.env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(payload as unknown),
      target_type: args.target_type,
      target_id: args.target_id,
      error_message: null,
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "skipped_no_api_key",
      media_id: 0,
      storage_key,
      prompt: args.prompt,
    };
  }

  // env.MEDIA.put writes the deterministic storage_key in R2. The same
  // (site_id, target_kind, target_id) input always overwrites the same key.
  await args.env.MEDIA.put(storage_key, imageResult.bytes, {
    httpMetadata: { contentType: imageResult.mime },
  });

  // INSERT INTO media — bind only; parameters carry site_id and
  // ai_generation_id so the admin UI can drill from a media tile back to
  // the typed receipts row.
  const mediaRow = await args.env.DB
    .prepare(
      "INSERT INTO media (filename, storage_key, mime_type, size_bytes, alt_text, folder, site_id, ai_generation_id) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(
      args.filename,
      storage_key,
      imageResult.mime,
      imageResult.bytes.byteLength,
      args.alt_text,
      args.folder,
      args.site_id,
      ai_generation_id,
    )
    .first<{ id: number }>();

  if (!mediaRow) {
    await finishGenerationLogFailure(args.env, {
      idempotency_key,
      error_message: "media INSERT returned no row",
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "failed",
      media_id: 0,
      storage_key,
      prompt: args.prompt,
    };
  }

  const payload = {
    media_id: mediaRow.id,
    storage_key,
    mime: imageResult.mime,
    size_bytes: imageResult.bytes.byteLength,
    meta: meta(args.task, imageResult.model, args.prompt_version, ai_generation_id, "success"),
  };
  await finishGenerationLogSuccess(args.env, {
    idempotency_key,
    response_json: { model: imageResult.model, size: args.size },
    parsed_json: redactSecretsFromPayload(payload as unknown),
    target_type: args.target_type,
    target_id: args.target_id,
  });

  return {
    ai_generation_id,
    idempotency_key,
    status: "success",
    media_id: mediaRow.id,
    storage_key,
    prompt: args.prompt,
  };
}
