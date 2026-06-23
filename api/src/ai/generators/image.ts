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
import { resolveCategoryPreset } from "./preset-resolver";

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

// T40 [BCL-077]: provisioning image generation is preset-governed. Each image
// step resolves its editable system preset by TASK KEY (logo / hero-image /
// feature-image, seeded is_system by migration 0020) and uses the preset's
// interpolated prompt as the image description, so editing the preset changes
// the generated image on the next setup. The image MODEL stays locked to
// SUPPORTED_IMAGE_MODELS (getImageModel) — a preset never widens that red line,
// so only the prompt is taken from the preset. With no matching preset the
// deterministic builder prompt is used (no crash, byte-identical to legacy).
async function resolveImagePresetPrompt(
  env: Env,
  category: string | undefined,
  fallbackCategory: string,
  vars: Record<string, string | undefined>,
): Promise<string | null> {
  const preset = await resolveCategoryPreset(
    env,
    category ?? fallbackCategory,
    vars,
  );
  return preset?.prompt ?? null;
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
  // T40 [BCL-077]: provisioning passes 'logo' so the editable system preset
  // governs the logo image description.
  presetCategory?: string;
}

export async function generateLogoPrompt(
  env: Env,
  input: GenerateLogoPromptInput,
): Promise<GenerateImagePromptResult> {
  const presetPrompt = await resolveImagePresetPrompt(
    env,
    input.presetCategory,
    "logo",
    {
      vertical: input.vertical,
      brand_name: input.brand_name,
      site_id: input.site_id,
    },
  );
  return runPromptGenerator({
    env,
    task: LOGO_PROMPT_TASK,
    prompt_version: LOGO_PROMPT_VERSION,
    target_type: "site_settings",
    target_id: input.site_id,
    target_kind: "logo",
    site_id: input.site_id,
    size: LOGO_SIZE,
    prompt: presetPrompt ?? buildLogoPrompt(input),
    client: input.client,
  });
}

export interface GenerateFeatureImagePromptInput
  extends BuildFeatureImagePromptInput {
  client?: OpenAIClient;
  article_slug?: string;
  // T40 [BCL-077]: provisioning passes its task key — 'hero-image' for the
  // homepage hero step, 'feature-image' for per-article images — plus the
  // brand_name the hero-image preset interpolates ({{brand_name}}).
  presetCategory?: string;
  brand_name?: string;
}

export async function generateFeatureImagePrompt(
  env: Env,
  input: GenerateFeatureImagePromptInput,
): Promise<GenerateImagePromptResult> {
  const targetId = input.article_slug ?? input.article_title;
  const presetPrompt = await resolveImagePresetPrompt(
    env,
    input.presetCategory,
    "feature-image",
    {
      title: input.article_title,
      vertical: input.vertical,
      brand_name: input.brand_name,
      site_id: input.site_id,
    },
  );
  return runPromptGenerator({
    env,
    task: FEATURE_IMAGE_PROMPT_TASK,
    prompt_version: FEATURE_PROMPT_VERSION,
    target_type: "article_feature_image",
    target_id: targetId,
    target_kind: "feature_image",
    site_id: input.site_id,
    size: FEATURE_IMAGE_SIZE,
    prompt: presetPrompt ?? buildFeatureImagePrompt(input),
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
  // T40 [BCL-077]: provisioning passes 'logo' so the editable system preset
  // governs the logo image description (model stays gpt-image-2).
  presetCategory?: string;
}

export async function generateLogoImage(
  env: Env,
  input: GenerateLogoImageInput,
): Promise<GenerateImageOutcome> {
  const presetPrompt = await resolveImagePresetPrompt(
    env,
    input.presetCategory,
    "logo",
    {
      vertical: input.vertical,
      brand_name: input.brand_name,
      site_id: input.site_id,
    },
  );
  const prompt = presetPrompt ?? buildLogoPrompt(input);
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

// rescue-4 round-4 (issue 1): feature images were repetitive + generic because
// EVERY article received a byte-identical prompt, so gpt-image-2 converged on the
// same faceless "person at a laptop" stock shot. Inject a deterministic per-article
// art-direction directive (seeded by the slug) so each image gets a distinct
// composition + subject + light, while staying reproducible (idempotent re-runs
// pick the same directive). 8 shots x 4 light moods = 32 combinations.
const ART_DIRECTION_SHOTS: readonly string[] = [
  "Compose a wide environmental establishing shot with the subject small inside a real, lived-in setting; plenty of context and negative space.",
  "Compose a tight macro close-up of a single telling object or detail; shallow depth of field, everything else falling soft.",
  "Compose a top-down flat-lay of the real tools, papers, or materials involved, arranged naturally on a surface.",
  "Compose a candid mid-action moment with real motion and texture, captured documentary-style, nothing posed.",
  "Compose a natural portrait of one person looking straight into the camera, relaxed and real, against a clean shallow background.",
  "Compose an evocative still-life that suggests the idea metaphorically rather than literally; one strong subject and deliberate shadow.",
  "Compose a candid interaction between two people in a genuine setting, captured from a respectful distance.",
  "Compose a place-led frame of the room, street, or space where this happens, with people incidental or absent.",
];
const ART_DIRECTION_LIGHT: readonly string[] = [
  "Soft natural window light with a calm, muted palette.",
  "Warm golden-hour directional light, rich but restrained color.",
  "Cool overcast daylight, quiet and desaturated.",
  "One bold side light with deliberate shadow and editorial contrast.",
];
function articleArtDirection(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const shot = ART_DIRECTION_SHOTS[h % ART_DIRECTION_SHOTS.length];
  const light = ART_DIRECTION_LIGHT[(h >>> 3) % ART_DIRECTION_LIGHT.length];
  return `${shot} ${light}`;
}

export interface GenerateFeatureImageInput extends BuildFeatureImagePromptInput {
  article_slug: string;
  client?: OpenAIClient;
  // T40 [BCL-077]: provisioning passes 'hero-image' (homepage hero) or
  // 'feature-image' (per-article) so the editable system preset governs the
  // image description; brand_name feeds the hero-image preset's {{brand_name}}.
  presetCategory?: string;
  brand_name?: string;
}

export async function generateFeatureImage(
  env: Env,
  input: GenerateFeatureImageInput,
): Promise<GenerateImageOutcome> {
  const presetPrompt = await resolveImagePresetPrompt(
    env,
    input.presetCategory,
    "feature-image",
    {
      title: input.article_title,
      vertical: input.vertical,
      brand_name: input.brand_name,
      site_id: input.site_id,
      // per-article variety token (issue 1) — resolves the preset's
      // {{art_direction}} so each article gets a distinct, concrete shot.
      art_direction: articleArtDirection(input.article_slug),
    },
  );
  const prompt = presetPrompt ?? buildFeatureImagePrompt(input);
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
    // T1/AC3: a real image failure WITH a key present surfaces as
    // failed/retryable — NEVER a silent 'fallback' stub presented as a
    // benign 0-media result. Only the failure receipt is written (no
    // 'fallback' parsed_json), and 'failed' is deliberately NOT in the
    // idempotency short-circuit set above, so the caller (or a later run)
    // can retry. The model id stays gpt-image-2 (imageModel is locked).
    await finishGenerationLogFailure(args.env, {
      idempotency_key,
      error_message: err instanceof Error ? err.message : String(err),
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

  // PR-2b: never persist a 0-byte image. generateImage already THROWS
  // EmptyImageResultError on an empty render (caught above → 'failed'/retriable),
  // but guard here too so a 0-length buffer from ANY path is recorded as
  // failed/retriable rather than written to R2 + inserted as a media row marked
  // 'success'. 'failed' is deliberately NOT in the idempotency short-circuit set
  // above, so the unit can retry. The model id stays locked (imageModel).
  if (imageResult.bytes.byteLength === 0) {
    await finishGenerationLogFailure(args.env, {
      idempotency_key,
      error_message: "image generation produced 0 bytes",
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
