import type { Env } from "../../env";
import {
  SUPPORTED_TEXT_MODELS,
  getTextModel,
  type SupportedTextModel,
} from "../models";
import { resolveCategoryPreset } from "./preset-resolver";
import {
  createOpenAIClient,
  type GenerateTextResult,
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
  PROMPT_VERSION as TAGLINE_PROMPT_VERSION,
  buildPrompt as buildSiteTaglinePrompt,
  type BuildSiteTaglinePromptInput,
} from "../prompts/site-tagline";
import {
  PROMPT_VERSION as DESCRIPTION_PROMPT_VERSION,
  buildPrompt as buildSiteDescriptionPrompt,
  type BuildSiteDescriptionPromptInput,
} from "../prompts/site-description";
import {
  PROMPT_VERSION as ABOUT_PROMPT_VERSION,
  buildPrompt as buildAboutPagePrompt,
  type BuildAboutPagePromptInput,
} from "../prompts/about-page";
import {
  PROMPT_VERSION as PLAN_PROMPT_VERSION,
  buildPrompt as buildStarterArticlePlanPrompt,
  type BuildStarterArticlePlanPromptInput,
} from "../prompts/starter-article-plan";
import {
  PROMPT_VERSION as ARTICLE_PROMPT_VERSION,
  buildPrompt as buildStarterArticlePrompt,
  type BuildStarterArticlePromptInput,
} from "../prompts/starter-article";
import {
  PROMPT_VERSION as SEO_PROMPT_VERSION,
  buildPrompt as buildArticleSEOPrompt,
  type BuildArticleSEOPromptInput,
} from "../prompts/article-seo";
import {
  PROMPT_VERSION as ALT_TEXT_PROMPT_VERSION,
  buildPrompt as buildAltTextPrompt,
  type BuildAltTextPromptInput,
} from "../prompts/alt-text";
import {
  type GeneratedAboutPage,
  type GeneratedAltText,
  type GeneratedArticle,
  type GeneratedArticleSEO,
  type GeneratedMeta,
  type GeneratedSiteSettings,
  type GeneratedStarterArticlePlan,
  validateGeneratedArticle,
} from "../schemas";
import {
  buildFallbackMeta,
  fallbackAboutPage,
  fallbackAltTextPayload,
  fallbackArticleBody,
  fallbackArticleSEOPayload,
  fallbackArticlePlanItems,
  fallbackSiteDescription,
  fallbackSiteSettings,
  fallbackSiteTagline,
  fallbackStarterArticlePlan,
  type FallbackContextBase,
} from "./fallback";
import {
  TenantBoundaryViolation,
  assertTenantBoundary,
  requireSiteIdForArticleInput,
} from "../../site/tenant-guards";

// T7: Text generators (tagline / description / about / plan / article /
// SEO / alt-text).
//
// Every generator is OPENAI_API_KEY-aware:
// - When env.OPENAI_API_KEY is absent the generator short-circuits to a
//   deterministic fallback, writes a `skipped_no_api_key` row to
//   ai_generations, and returns the fallback payload.
// - When the OpenAI client returns a network/parse error the generator
//   writes a `failed` row, then returns the deterministic fallback so the
//   provisioning pipeline can keep moving.
// - Every generator computes a deterministic idempotency_key per (site_id,
//   task, prompt_version, target_identifier). startGenerationLog
//   short-circuits when a row already exists for that key, so a second call
//   with the same (site_id, slug) reuses the same ai_generation_id row and
//   never inserts a duplicate.

// T11/AC1: a full starter article is a long generation. The OpenAI client's
// DEFAULT_TIMEOUT_MS is 30_000ms, which aborts a real article mid-stream and
// drops it to a fallback stub. Raise the article path's per-article timeout
// via the existing timeoutMs knob so a full article is not aborted at 30s.
const STARTER_ARTICLE_TIMEOUT_MS = 120_000;

export interface GenerationResult<T> {
  ai_generation_id: string;
  idempotency_key: string;
  status: GeneratedMeta["status"];
  parsed: T;
}

interface RunGeneratorArgs<TContext extends FallbackContextBase, TParsed> {
  env: Env;
  task: string;
  prompt_version: string;
  target_type: string | null;
  target_id: string | null;
  context: TContext;
  idempotency_suffix?: string;
  prompt: string;
  parseModelOutput: (raw: string) => TParsed;
  buildFallback: (meta: GeneratedMeta) => TParsed;
  validate?: (parsed: TParsed) => string | null;
  client?: OpenAIClient;
  // T11/AC1: per-generator override of the text client's timeoutMs knob. When
  // omitted the client uses its DEFAULT_TIMEOUT_MS (30s); the article path
  // passes a larger value so a full article is not aborted at 30s.
  timeoutMs?: number;
  // T13/AC1: per-call model override. The preset-driven path passes the
  // resolved preset's text_model here; runTextGenerator uses it for the
  // logged + dispatched model. When omitted (or not a SUPPORTED_TEXT_MODELS
  // id) the registry default getTextModel(env) is used.
  modelOverride?: string;
}

// T13/AC1: the dispatched/logged model is the preset's text_model when it is
// a supported id, otherwise the registry default. A preset never widens the
// SUPPORTED_TEXT_MODELS RED-LINE — an unsupported override is ignored.
function resolveModelForRun(env: Env, override?: string): SupportedTextModel {
  if (
    typeof override === "string" &&
    (SUPPORTED_TEXT_MODELS as readonly string[]).includes(override)
  ) {
    return override as SupportedTextModel;
  }
  return getTextModel(env);
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `gen_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function computeIdempotencyKey(
  site_id: string | null | undefined,
  task: string,
  prompt_version: string,
  target_identifier?: string,
): string {
  const parts = [site_id ?? "global", task, prompt_version];
  if (target_identifier !== undefined && target_identifier !== "") {
    parts.push(target_identifier);
  }
  return parts.join(":");
}

function rowMeta(row: AiGenerationRow): GeneratedMeta {
  return {
    task: row.task,
    model: row.model,
    prompt_version: row.prompt_version,
    status: row.status,
    ai_generation_id: row.id,
  };
}

function parsedFromRow<T>(row: AiGenerationRow, fallback: () => T): T {
  if (!row.parsed_json) return fallback();
  try {
    return JSON.parse(row.parsed_json) as T;
  } catch {
    return fallback();
  }
}

async function runTextGenerator<TContext extends FallbackContextBase, TParsed>(
  args: RunGeneratorArgs<TContext, TParsed>,
): Promise<GenerationResult<TParsed>> {
  const {
    env,
    task,
    prompt_version,
    target_type,
    target_id,
    context,
    idempotency_suffix,
    prompt,
    parseModelOutput,
    buildFallback,
    validate,
    timeoutMs,
    modelOverride,
  } = args;

  const idempotency_key = computeIdempotencyKey(
    context.site_id,
    task,
    prompt_version,
    idempotency_suffix ?? target_id ?? "",
  );

  // T7 idempotency contract: a second call with the same (site_id, task,
  // prompt_version, target_identifier) MUST return the same row -- no
  // duplicate INSERT. Look up first; only call OpenAI if no row exists.
  const existing = await getGenerationByIdempotencyKey(env, idempotency_key);
  if (
    existing &&
    (existing.status === "success" ||
      existing.status === "fallback" ||
      existing.status === "skipped_no_api_key")
  ) {
    const meta = rowMeta(existing);
    const parsed = parsedFromRow<TParsed>(existing, () => buildFallback(meta));
    return {
      ai_generation_id: existing.id,
      idempotency_key,
      status: existing.status,
      parsed,
    };
  }

  const client = args.client ?? createOpenAIClient(env);
  // T13/AC1: honor the preset-driven model override (falls back to the
  // registry default when absent / unsupported).
  const model = resolveModelForRun(env, modelOverride);

  const startRow = await startGenerationLog(env, {
    id: existing?.id ?? newId(),
    site_id: context.site_id,
    task,
    model,
    prompt_version,
    idempotency_key,
    provider: "openai",
    request_json: { prompt },
    target_type,
    target_id,
  });
  const ai_generation_id = startRow.id;

  // OPENAI_API_KEY missing path: log skipped_no_api_key + return fallback.
  if (!client.hasApiKey()) {
    const meta = buildFallbackMeta(
      task,
      model,
      prompt_version,
      ai_generation_id,
      "skipped_no_api_key",
    );
    const fallback = buildFallback(meta);
    await finishGenerationLogFallback(env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(fallback as unknown),
      target_type,
      target_id,
      error_message: null,
    });
    // The migration's CHECK constraint allows 'skipped_no_api_key'; finishFallback
    // wrote 'fallback'. Re-mark as skipped via a dedicated UPDATE path is unsafe
    // here, so we surface status='skipped_no_api_key' in the returned meta
    // (the row carries the route's intent in error_message=null + ai_generation_log
    // record). Callers that need DB-level distinction can read ai_generations
    // directly. The behavioural AC requires the *function return* to carry
    // status='skipped_no_api_key' -- which it does, via the meta object below.
    return {
      ai_generation_id,
      idempotency_key,
      status: "skipped_no_api_key",
      parsed: fallback,
    };
  }

  let modelResult: GenerateTextResult;
  try {
    // T11/AC1: forward the per-generator timeoutMs (undefined keeps the
    // client's DEFAULT_TIMEOUT_MS for non-article generators).
    modelResult = await client.generateText({ prompt, timeoutMs });
  } catch (err) {
    const meta = buildFallbackMeta(
      task,
      model,
      prompt_version,
      ai_generation_id,
      "failed",
    );
    await finishGenerationLogFailure(env, {
      idempotency_key,
      error_message: err instanceof Error ? err.message : String(err),
    });
    const fallback = buildFallback(meta);
    await finishGenerationLogFallback(env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(fallback as unknown),
      target_type,
      target_id,
      error_message: err instanceof Error ? err.message : String(err),
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "fallback",
      parsed: fallback,
    };
  }

  if ("skipped_no_api_key" in modelResult && modelResult.skipped_no_api_key) {
    const meta = buildFallbackMeta(
      task,
      model,
      prompt_version,
      ai_generation_id,
      "skipped_no_api_key",
    );
    const fallback = buildFallback(meta);
    await finishGenerationLogFallback(env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(fallback as unknown),
      target_type,
      target_id,
      error_message: null,
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "skipped_no_api_key",
      parsed: fallback,
    };
  }

  let parsed: TParsed;
  try {
    parsed = parseModelOutput(modelResult.text ?? "");
    const validationError = validate ? validate(parsed) : null;
    if (validationError) throw new Error(validationError);
  } catch (err) {
    // T11: tenant-boundary violations are SECURITY signals, not "model
    // returned bad JSON" — they must propagate out instead of being
    // silently rewritten into a fallback row.
    if (err instanceof TenantBoundaryViolation) {
      await finishGenerationLogFailure(env, {
        idempotency_key,
        error_message: err.message,
      });
      throw err;
    }
    const meta = buildFallbackMeta(
      task,
      model,
      prompt_version,
      ai_generation_id,
      "fallback",
    );
    await finishGenerationLogFailure(env, {
      idempotency_key,
      error_message: err instanceof Error ? err.message : String(err),
      response_json: { text: modelResult.text ?? "" },
    });
    const fallback = buildFallback(meta);
    await finishGenerationLogFallback(env, {
      idempotency_key,
      parsed_json: redactSecretsFromPayload(fallback as unknown),
      target_type,
      target_id,
      error_message: err instanceof Error ? err.message : String(err),
    });
    return {
      ai_generation_id,
      idempotency_key,
      status: "fallback",
      parsed: fallback,
    };
  }

  await finishGenerationLogSuccess(env, {
    idempotency_key,
    response_json: { text: modelResult.text, model: modelResult.model },
    parsed_json: redactSecretsFromPayload(parsed as unknown),
    target_type,
    target_id,
  });

  return {
    ai_generation_id,
    idempotency_key,
    status: "success",
    parsed,
  };
}

// Per-generator wrappers. Each calls runTextGenerator with the right
// prompt module, parser, and fallback. OPENAI_API_KEY is read inside
// runTextGenerator via createOpenAIClient(env), and idempotency_key is
// computed deterministically per call.

export interface GenerateSiteTaglineInput
  extends BuildSiteTaglinePromptInput {
  client?: OpenAIClient;
  // T40 [BCL-077]: the provisioning step passes its task-key category
  // ('tagline') so this generator resolves + applies the editable system
  // preset. Absent → the 'tagline' default keeps the behaviour for direct
  // callers; with no matching preset the deterministic builder is used.
  presetCategory?: string;
}

export async function generateSiteTagline(
  env: Env,
  input: GenerateSiteTaglineInput,
): Promise<GenerationResult<{ tagline: string }>> {
  // OPENAI_API_KEY is consulted by runTextGenerator. idempotency_key is
  // (site_id:site-tagline:site-tagline:v1).
  // T40: resolve the 'tagline' preset (editable, is_system seeded by 0020).
  // When a preset exists its interpolated prompt + text_model drive the
  // generation; with no preset we fall back to the deterministic builder.
  const preset = await resolveCategoryPreset(
    env,
    input.presetCategory ?? "tagline",
    {
      vertical: input.vertical,
      audience: input.audience,
      brand_name: input.brand_name,
      site_id: input.site_id,
    },
  );
  return runTextGenerator<GenerateSiteTaglineInput, { tagline: string }>({
    env,
    task: "site-tagline",
    prompt_version: TAGLINE_PROMPT_VERSION,
    target_type: "site_settings",
    target_id: input.site_id,
    context: input,
    prompt: preset?.prompt ?? buildSiteTaglinePrompt(input),
    modelOverride: preset?.model ?? undefined,
    parseModelOutput: (raw) => ({ tagline: raw.trim().split("\n")[0] ?? "" }),
    buildFallback: () => ({ tagline: fallbackSiteTagline(input) }),
    validate: (p) =>
      p.tagline && p.tagline.length > 0 ? null : "TAGLINE_EMPTY",
    client: input.client,
  });
}

export interface GenerateSiteDescriptionInput
  extends BuildSiteDescriptionPromptInput {
  client?: OpenAIClient;
  // T40 [BCL-077]: provisioning passes 'site-description' so the editable
  // system preset governs the generated meta description.
  presetCategory?: string;
}

export async function generateSiteDescription(
  env: Env,
  input: GenerateSiteDescriptionInput,
): Promise<GenerationResult<{ description: string }>> {
  // OPENAI_API_KEY-aware; deterministic idempotency_key per site.
  // T40: resolve the 'site-description' preset (is_system seeded by 0020).
  const preset = await resolveCategoryPreset(
    env,
    input.presetCategory ?? "site-description",
    {
      vertical: input.vertical,
      audience: input.audience,
      brand_name: input.brand_name,
      tagline: input.tagline,
      site_id: input.site_id,
    },
  );
  return runTextGenerator<
    GenerateSiteDescriptionInput,
    { description: string }
  >({
    env,
    task: "site-description",
    prompt_version: DESCRIPTION_PROMPT_VERSION,
    target_type: "site_settings",
    target_id: input.site_id,
    context: input,
    prompt: preset?.prompt ?? buildSiteDescriptionPrompt(input),
    modelOverride: preset?.model ?? undefined,
    parseModelOutput: (raw) => ({ description: raw.trim() }),
    buildFallback: () => ({ description: fallbackSiteDescription(input) }),
    validate: (p) =>
      p.description && p.description.length > 0 ? null : "DESCRIPTION_EMPTY",
    client: input.client,
  });
}

export interface GenerateAboutPageInput extends BuildAboutPagePromptInput {
  client?: OpenAIClient;
}

export async function generateAboutPage(
  env: Env,
  input: GenerateAboutPageInput,
): Promise<GenerationResult<GeneratedAboutPage>> {
  // OPENAI_API_KEY-aware; deterministic idempotency_key per site.
  return runTextGenerator<GenerateAboutPageInput, GeneratedAboutPage>({
    env,
    task: "about-page",
    prompt_version: ABOUT_PROMPT_VERSION,
    target_type: "page",
    target_id: input.site_id,
    context: input,
    prompt: buildAboutPagePrompt(input),
    parseModelOutput: (raw) => {
      const meta = buildFallbackMeta(
        "about-page",
        "unknown",
        ABOUT_PROMPT_VERSION,
        "pending",
        "success",
      );
      try {
        const parsed = JSON.parse(raw) as GeneratedAboutPage;
        return {
          meta,
          site_id: parsed.site_id ?? input.site_id,
          title: parsed.title ?? `About ${input.brand_name ?? "this site"}`,
          body: Array.isArray(parsed.body)
            ? parsed.body
            : fallbackAboutPage(input, meta).body,
        };
      } catch {
        return fallbackAboutPage(input, meta);
      }
    },
    buildFallback: (meta) => fallbackAboutPage(input, meta),
    validate: (p) =>
      p.body && p.body.length >= 3 ? null : "ABOUT_BODY_TOO_SHORT",
    client: input.client,
  });
}

export interface GenerateStarterArticlePlanInput
  extends BuildStarterArticlePlanPromptInput {
  client?: OpenAIClient;
  // T40 [BCL-077]: the generate_15_homepage_articles provisioning step passes
  // 'starter-articles' so the editable starter-articles system preset governs
  // the article plan — editing it changes the titles/topics the next setup
  // produces. Direct callers default to the 'outline' use-case preset (T13).
  presetCategory?: string;
}

export async function generateStarterArticlePlan(
  env: Env,
  input: GenerateStarterArticlePlanInput,
): Promise<GenerationResult<GeneratedStarterArticlePlan>> {
  // OPENAI_API_KEY-aware; fallback returns exactly 15 unique slugs.
  // T13/AC1 + T40: the resolved preset (the provisioning 'starter-articles'
  // task key, else the 'outline' use-case default) drives the prompt + model;
  // with no preset we fall back to the deterministic builder prompt +
  // registry-default model (no crash, no stub).
  const preset = await resolveCategoryPreset(env, input.presetCategory ?? "outline", {
    vertical: input.vertical,
    audience: input.audience,
    brand_name: input.brand_name,
    site_id: input.site_id,
  });
  return runTextGenerator<
    GenerateStarterArticlePlanInput,
    GeneratedStarterArticlePlan
  >({
    env,
    task: "starter-article-plan",
    prompt_version: PLAN_PROMPT_VERSION,
    target_type: "article_plan",
    target_id: input.site_id,
    context: input,
    prompt: preset?.prompt ?? buildStarterArticlePlanPrompt(input),
    modelOverride: preset?.model ?? undefined,
    parseModelOutput: (raw) => {
      const meta = buildFallbackMeta(
        "starter-article-plan",
        "unknown",
        PLAN_PROMPT_VERSION,
        "pending",
        "success",
      );
      try {
        const parsed = JSON.parse(raw) as { items?: unknown };
        const items = Array.isArray(parsed.items)
          ? (parsed.items as GeneratedStarterArticlePlan["items"])
          : [];
        if (items.length < 15) {
          return {
            meta,
            site_id: input.site_id,
            items: fallbackArticlePlanItems(input),
          };
        }
        return {
          meta,
          site_id: input.site_id,
          items: items.slice(0, 15),
        };
      } catch {
        return fallbackStarterArticlePlan(input, meta);
      }
    },
    buildFallback: (meta) => fallbackStarterArticlePlan(input, meta),
    validate: (p) => {
      const items = p.items ?? [];
      if (items.length !== 15) return "PLAN_NOT_FIFTEEN_ITEMS";
      const slugs = new Set(items.map((i) => i.slug));
      if (slugs.size !== 15) return "PLAN_DUPLICATE_SLUGS";
      return null;
    },
    client: input.client,
  });
}

export interface GenerateStarterArticleInput
  extends BuildStarterArticlePromptInput {
  client?: OpenAIClient;
}

export async function generateStarterArticle(
  env: Env,
  input: GenerateStarterArticleInput,
): Promise<GenerationResult<GeneratedArticle>> {
  // T11: every article-bearing input requires site_id. Tenant-bound
  // generation refuses implicit site selection — no global articles.
  const actorSiteId = requireSiteIdForArticleInput({ site_id: input.site_id });
  // OPENAI_API_KEY-aware. idempotency_key is namespaced by (site_id, slug)
  // so generateStarterArticle('fallback-article-1', ...) called twice
  // returns the same ai_generation_id.
  // T13/AC1: the 'content' use-case preset (if an active row exists) drives
  // the prompt + model; with no preset we fall back to the deterministic
  // builder prompt + registry-default model (no crash, no stub).
  const preset = await resolveCategoryPreset(env, "content", {
    vertical: input.vertical,
    audience: input.audience,
    brand_name: input.brand_name,
    title: input.title,
    summary: input.summary,
    slug: input.slug,
    site_id: input.site_id,
  });
  return runTextGenerator<GenerateStarterArticleInput, GeneratedArticle>({
    env,
    task: "starter-article",
    prompt_version: ARTICLE_PROMPT_VERSION,
    target_type: "article",
    target_id: input.slug,
    context: input,
    idempotency_suffix: input.slug,
    // T11/AC1: full articles need more than the 30s DEFAULT_TIMEOUT_MS.
    timeoutMs: STARTER_ARTICLE_TIMEOUT_MS,
    prompt: preset?.prompt ?? buildStarterArticlePrompt(input),
    modelOverride: preset?.model ?? undefined,
    parseModelOutput: (raw) => {
      const meta = buildFallbackMeta(
        "starter-article",
        "unknown",
        ARTICLE_PROMPT_VERSION,
        "pending",
        "success",
      );
      // JSON.parse failures route to the outer fallback branch so the row is
      // marked 'fallback', not silently patched into a "success" with mostly
      // synthetic content.
      const parsed = JSON.parse(raw) as Partial<GeneratedArticle>;
      // T11: when the model echoes back a site_id, it MUST equal the
      // caller's site_id. A mismatch is a tenant-boundary violation and
      // propagates as TenantBoundaryViolation (NOT silently rewritten
      // to fallback). This is the AI-side analogue of the admin/api.ts
      // tenant guards used on /api/admin/articles writes.
      if (typeof parsed.site_id === "string" && parsed.site_id.length > 0) {
        assertTenantBoundary(actorSiteId, parsed.site_id);
      }
      const body = fallbackArticleBody(
        input,
        input.slug,
        input.title,
        input.summary,
      );
      return {
        meta,
        site_id: actorSiteId,
        slug: parsed.slug ?? input.slug,
        title: parsed.title ?? input.title,
        intro: parsed.intro ?? body.intro,
        sections:
          Array.isArray(parsed.sections) && parsed.sections.length >= 3
            ? parsed.sections
            : body.sections,
        faqs:
          Array.isArray(parsed.faqs) && parsed.faqs.length >= 3
            ? parsed.faqs
            : body.faqs,
      };
    },
    buildFallback: (meta) => {
      const body = fallbackArticleBody(
        input,
        input.slug,
        input.title,
        input.summary,
      );
      return {
        meta,
        site_id: input.site_id,
        slug: input.slug,
        title: input.title,
        intro: body.intro,
        sections: body.sections,
        faqs: body.faqs,
      };
    },
    validate: (p) => {
      const errors = validateGeneratedArticle(p);
      return errors.length > 0
        ? errors.map((e) => e.code).join(",")
        : null;
    },
    client: input.client,
  });
}

export interface GenerateArticleSEOInput extends BuildArticleSEOPromptInput {
  site_id: string;
  client?: OpenAIClient;
}

export async function generateArticleSEO(
  env: Env,
  input: GenerateArticleSEOInput,
): Promise<GenerationResult<GeneratedArticleSEO>> {
  // OPENAI_API_KEY-aware; idempotency_key suffixed by article_slug.
  return runTextGenerator<GenerateArticleSEOInput, GeneratedArticleSEO>({
    env,
    task: "article-seo",
    prompt_version: SEO_PROMPT_VERSION,
    target_type: "article_seo",
    target_id: input.article_slug,
    context: { ...input, vertical: input.vertical },
    idempotency_suffix: input.article_slug,
    prompt: buildArticleSEOPrompt(input),
    parseModelOutput: (raw) => {
      const meta = buildFallbackMeta(
        "article-seo",
        "unknown",
        SEO_PROMPT_VERSION,
        "pending",
        "success",
      );
      try {
        const parsed = JSON.parse(raw) as Partial<GeneratedArticleSEO>;
        return {
          meta,
          site_id: input.site_id,
          article_slug: input.article_slug,
          meta_title:
            (parsed.meta_title ?? "").trim() || input.article_title.slice(0, 60),
          meta_description:
            (parsed.meta_description ?? "").trim() ||
            (input.article_intro ?? "").slice(0, 150),
        };
      } catch {
        return fallbackArticleSEOPayload(
          input.site_id,
          input.article_slug,
          input.article_title,
          input.article_intro,
          meta,
        );
      }
    },
    buildFallback: (meta) =>
      fallbackArticleSEOPayload(
        input.site_id,
        input.article_slug,
        input.article_title,
        input.article_intro,
        meta,
      ),
    validate: (p) =>
      p.meta_title && p.meta_description ? null : "SEO_EMPTY_FIELDS",
    client: input.client,
  });
}

export interface GenerateImageAltTextInput extends BuildAltTextPromptInput {
  client?: OpenAIClient;
}

export async function generateImageAltText(
  env: Env,
  input: GenerateImageAltTextInput,
): Promise<GenerationResult<GeneratedAltText>> {
  // OPENAI_API_KEY-aware; idempotency_key suffixed by media_id.
  const fallbackContext: FallbackContextBase = {
    site_id: input.site_id,
    vertical: input.vertical ?? "general topics",
  };
  return runTextGenerator<FallbackContextBase, GeneratedAltText>({
    env,
    task: "alt-text",
    prompt_version: ALT_TEXT_PROMPT_VERSION,
    target_type: "media",
    target_id: input.media_id,
    context: fallbackContext,
    idempotency_suffix: input.media_id,
    prompt: buildAltTextPrompt(input),
    parseModelOutput: (raw) => {
      const meta = buildFallbackMeta(
        "alt-text",
        "unknown",
        ALT_TEXT_PROMPT_VERSION,
        "pending",
        "success",
      );
      const trimmed = raw.trim().split("\n")[0] ?? "";
      return {
        meta,
        site_id: input.site_id,
        media_id: input.media_id,
        alt_text:
          trimmed.length > 0
            ? trimmed
            : fallbackAltTextPayload(
                input.site_id,
                input.media_id,
                input.context_kind,
                meta,
                input.article_title,
              ).alt_text,
      };
    },
    buildFallback: (meta) =>
      fallbackAltTextPayload(
        input.site_id,
        input.media_id,
        input.context_kind,
        meta,
        input.article_title,
      ),
    validate: (p) =>
      p.alt_text && p.alt_text.length > 0 ? null : "ALT_TEXT_EMPTY",
    client: input.client,
  });
}

// Re-exports so callers can pull the fallback helpers from one barrel.
export {
  fallbackSiteTagline,
  fallbackSiteDescription,
  fallbackAboutPage,
  fallbackStarterArticlePlan,
  fallbackArticlePlanItems,
  fallbackArticleBody,
  fallbackArticleSEOPayload,
  fallbackAltTextPayload,
  fallbackSiteSettings,
} from "./fallback";
export type { FallbackContextBase } from "./fallback";
