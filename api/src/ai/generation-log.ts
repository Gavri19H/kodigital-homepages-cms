import type { Env } from "../env";
import type { GeneratedStatus } from "./schemas";

// T6: ai_generations CRUD with idempotency lookup + secret redaction.
// Every D1 call is `db.prepare(<static SQL>).bind(...)` -- never a template
// literal -- and any payload value that traverses request_json / response_json
// / parsed_json / error_message passes through redactSecretsFromPayload to
// guarantee 'sk-...' bearer tokens or OPENAI_API_KEY values never land in
// the typed receipts table.

const REDACTED = "[REDACTED]";
const SK_KEY_PATTERN = /sk-[A-Za-z0-9_\-]{4,}/g;
const BEARER_PATTERN = /Bearer\s+sk-[A-Za-z0-9_\-]{4,}/gi;

export type GenerationLogStatus = GeneratedStatus;

export interface AiGenerationRow {
  id: string;
  site_id: string | null;
  task: string;
  provider: string;
  model: string;
  prompt_version: string;
  idempotency_key: string;
  request_json: string | null;
  response_json: string | null;
  parsed_json: string | null;
  status: GenerationLogStatus;
  target_type: string | null;
  target_id: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface StartGenerationLogInput {
  id: string;
  site_id: string | null;
  task: string;
  model: string;
  prompt_version: string;
  idempotency_key: string;
  provider?: string;
  request_json?: unknown;
  target_type?: string | null;
  target_id?: string | null;
}

export interface FinishSuccessInput {
  idempotency_key: string;
  response_json?: unknown;
  parsed_json?: unknown;
  target_type?: string | null;
  target_id?: string | null;
}

export interface FinishFailureInput {
  idempotency_key: string;
  error_message: string;
  response_json?: unknown;
}

export interface FinishFallbackInput {
  idempotency_key: string;
  parsed_json?: unknown;
  target_type?: string | null;
  target_id?: string | null;
  error_message?: string | null;
}

// redactSecretsFromPayload walks the value tree and rewrites every string
// that contains an `sk-...` OpenAI key (or `Bearer sk-...`) to [REDACTED].
// Used by both startGenerationLog (request_json) and finishGenerationLog*
// (response_json / parsed_json / error_message) so OPENAI_API_KEY / sk-
// material can never reach the ai_generations table.
export function redactSecretsFromPayload<T>(value: T): T {
  return redactValue(value) as T;
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v);
    }
    return out;
  }
  return value;
}

function redactString(input: string): string {
  return input.replace(BEARER_PATTERN, `Bearer ${REDACTED}`).replace(
    SK_KEY_PATTERN,
    REDACTED,
  );
}

function toJsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return redactString(value);
  return JSON.stringify(redactValue(value));
}

// SQL is a static literal -- never built from template interpolation -- so
// every parameter is bound via .bind(...) per the D1 safety contract.
const INSERT_SQL =
  "INSERT INTO ai_generations (" +
  "id, site_id, task, provider, model, prompt_version, idempotency_key, " +
  "request_json, response_json, parsed_json, status, target_type, target_id, " +
  "error_message, created_at, updated_at" +
  ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?, NULL, " +
  "unixepoch(), unixepoch())";

const SELECT_BY_KEY_SQL =
  "SELECT id, site_id, task, provider, model, prompt_version, " +
  "idempotency_key, request_json, response_json, parsed_json, status, " +
  "target_type, target_id, error_message, created_at, updated_at " +
  "FROM ai_generations WHERE idempotency_key = ? LIMIT 1";

const UPDATE_SUCCESS_SQL =
  "UPDATE ai_generations SET status = 'success', response_json = ?, " +
  "parsed_json = ?, target_type = COALESCE(?, target_type), " +
  "target_id = COALESCE(?, target_id), error_message = NULL, " +
  "updated_at = unixepoch() WHERE idempotency_key = ?";

const UPDATE_FAILURE_SQL =
  "UPDATE ai_generations SET status = 'failed', response_json = ?, " +
  "error_message = ?, updated_at = unixepoch() WHERE idempotency_key = ?";

const UPDATE_FALLBACK_SQL =
  "UPDATE ai_generations SET status = 'fallback', parsed_json = ?, " +
  "target_type = COALESCE(?, target_type), " +
  "target_id = COALESCE(?, target_id), error_message = ?, " +
  "updated_at = unixepoch() WHERE idempotency_key = ?";

export async function startGenerationLog(
  env: Env,
  input: StartGenerationLogInput,
): Promise<AiGenerationRow> {
  const existing = await getGenerationByIdempotencyKey(env, input.idempotency_key);
  if (existing) return existing;
  const requestJson = toJsonOrNull(input.request_json);
  await env.DB.prepare(INSERT_SQL)
    .bind(
      input.id,
      input.site_id,
      input.task,
      input.provider ?? "openai",
      input.model,
      input.prompt_version,
      input.idempotency_key,
      requestJson,
      input.target_type ?? null,
      input.target_id ?? null,
    )
    .run();
  const row = await getGenerationByIdempotencyKey(env, input.idempotency_key);
  if (!row) {
    throw new Error(
      `startGenerationLog: row missing after insert (idempotency_key=${input.idempotency_key})`,
    );
  }
  return row;
}

export async function getGenerationByIdempotencyKey(
  env: Env,
  idempotency_key: string,
): Promise<AiGenerationRow | null> {
  const row = await env.DB.prepare(SELECT_BY_KEY_SQL)
    .bind(idempotency_key)
    .first<AiGenerationRow>();
  return row ?? null;
}

export async function finishGenerationLogSuccess(
  env: Env,
  input: FinishSuccessInput,
): Promise<AiGenerationRow | null> {
  await env.DB.prepare(UPDATE_SUCCESS_SQL)
    .bind(
      toJsonOrNull(input.response_json),
      toJsonOrNull(input.parsed_json),
      input.target_type ?? null,
      input.target_id ?? null,
      input.idempotency_key,
    )
    .run();
  return getGenerationByIdempotencyKey(env, input.idempotency_key);
}

export async function finishGenerationLogFailure(
  env: Env,
  input: FinishFailureInput,
): Promise<AiGenerationRow | null> {
  await env.DB.prepare(UPDATE_FAILURE_SQL)
    .bind(
      toJsonOrNull(input.response_json),
      redactString(input.error_message),
      input.idempotency_key,
    )
    .run();
  return getGenerationByIdempotencyKey(env, input.idempotency_key);
}

export async function finishGenerationLogFallback(
  env: Env,
  input: FinishFallbackInput,
): Promise<AiGenerationRow | null> {
  await env.DB.prepare(UPDATE_FALLBACK_SQL)
    .bind(
      toJsonOrNull(input.parsed_json),
      input.target_type ?? null,
      input.target_id ?? null,
      input.error_message ? redactString(input.error_message) : null,
      input.idempotency_key,
    )
    .run();
  return getGenerationByIdempotencyKey(env, input.idempotency_key);
}
