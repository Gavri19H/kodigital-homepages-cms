import type { Env } from "../env";
import {
  getImageModel,
  getTextModel,
  type SupportedImageModel,
  type SupportedTextModel,
} from "./models";

// T2: Worker-compatible OpenAI client. Pure fetch + AbortController; no
// node: imports. env.OPENAI_API_KEY is read once; redactApiKey() /
// redactSecretsFromText() scrub any value before it can reach a log.

const OPENAI_TEXT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGE_URL = "https://api.openai.com/v1/images/generations";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 1;
const RETRY_DELAY_MS = 250;
const REDACTED = "[REDACTED]";
const SK_KEY_PATTERN = /sk-[A-Za-z0-9_\-]{4,}/g;

export type GenerateTextSkipped = { skipped_no_api_key: true };
export type GenerateTextSuccess = {
  skipped_no_api_key?: false;
  text: string;
  model: SupportedTextModel;
  retries: number;
  status: number;
};
export type GenerateTextResult = GenerateTextSkipped | GenerateTextSuccess;

export type GenerateImageSkipped = { skipped_no_api_key: true };
export type GenerateImageSuccess = {
  skipped_no_api_key?: false;
  bytes: ArrayBuffer;
  mime: string;
  model: SupportedImageModel;
  retries: number;
  status: number;
};
export type GenerateImageResult = GenerateImageSkipped | GenerateImageSuccess;

export interface GenerateTextOptions {
  prompt: string;
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GenerateImageOptions {
  prompt: string;
  size?: string;
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface OpenAIClient {
  generateText(opts: GenerateTextOptions): Promise<GenerateTextResult>;
  generateImage(opts: GenerateImageOptions): Promise<GenerateImageResult>;
  hasApiKey(): boolean;
}

export function redactApiKey(key: string | undefined): string {
  return key ? REDACTED : REDACTED;
}

export function redactSecretsFromText(input: string): string {
  return input ? input.replace(SK_KEY_PATTERN, REDACTED) : input;
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// T11/AC2: a timed-out / aborted request is retriable, alongside
// isRetriableStatus 429/5xx. fetchWithTimeout aborts via AbortController at
// timeoutMs, which rejects with an AbortError (DOMException/Error name
// "AbortError"); some runtimes surface a "TimeoutError" instead. We classify
// by error name first, then fall back to message text, so a slow full-article
// generation is retried rather than surfaced immediately as a fallback stub.
function isAbortOrTimeoutError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const message = (err as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    /\b(abort(ed)?|timed?\s*out|timeout)\b/i.test(message)
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (!b64) return new ArrayBuffer(0);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function createOpenAIClient(env: Env): OpenAIClient {
  const apiKey = env.OPENAI_API_KEY;
  const hasKey = typeof apiKey === "string" && apiKey.trim() !== "";

  async function callWithRetry(
    url: string,
    body: unknown,
    maxRetries: number,
    timeoutMs: number,
    fetchImpl: typeof fetch,
  ): Promise<{ response: Response; retries: number }> {
    let attempt = 0;
    let last: Response | null = null;
    while (attempt <= maxRetries) {
      let response: Response;
      try {
        response = await fetchWithTimeout(
          url,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${apiKey ?? ""}`,
            },
            body: JSON.stringify(body),
          },
          timeoutMs,
          fetchImpl,
        );
      } catch (err) {
        // T11/AC2: an aborted/timed-out call is retried (timeout/abort added
        // to the retriable set alongside isRetriableStatus 429/5xx). If
        // retries remain, back off and retry; otherwise rethrow so the
        // caller's fallback path runs (surfaced in receipts). Non-abort
        // errors are NOT retried — they propagate immediately.
        if (isAbortOrTimeoutError(err) && attempt < maxRetries) {
          attempt += 1;
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
      last = response;
      if (!isRetriableStatus(response.status) || attempt === maxRetries) {
        return { response, retries: attempt };
      }
      attempt += 1;
      await sleep(RETRY_DELAY_MS);
    }
    return { response: last as Response, retries: attempt };
  }

  return {
    hasApiKey: () => hasKey,

    async generateText(opts) {
      if (!hasKey) return { skipped_no_api_key: true };
      const model = getTextModel(env);
      const { response, retries } = await callWithRetry(
        OPENAI_TEXT_URL,
        { model, messages: [{ role: "user", content: opts.prompt }] },
        opts.maxRetries ?? DEFAULT_MAX_RETRIES,
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        opts.fetchImpl ?? fetch,
      );
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(
          `OpenAI text request failed: status=${response.status} body=${redactSecretsFromText(errText).slice(0, 500)}`,
        );
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return {
        text: json?.choices?.[0]?.message?.content ?? "",
        model,
        retries,
        status: response.status,
      };
    },

    async generateImage(opts) {
      if (!hasKey) return { skipped_no_api_key: true };
      const model = getImageModel(env);
      const fetchImpl = opts.fetchImpl ?? fetch;
      const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      // T10/AC1: gpt-image-2 rejects `response_format` with a 400
      // ("Unknown parameter: response_format"). The model id is locked by
      // the brief and stays unchanged; the request body MUST NOT carry a
      // response_format key.
      const { response, retries } = await callWithRetry(
        OPENAI_IMAGE_URL,
        {
          model,
          prompt: opts.prompt,
          size: opts.size ?? "1024x1024",
        },
        opts.maxRetries ?? DEFAULT_MAX_RETRIES,
        timeoutMs,
        fetchImpl,
      );
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(
          `OpenAI image request failed: status=${response.status} body=${redactSecretsFromText(errText).slice(0, 500)}`,
        );
      }
      const json = (await response.json()) as {
        data?: Array<{ b64_json?: string; url?: string }>;
      };
      // T10/AC2: read whichever shape the API returns —
      // data[0].b64_json (inline base64) ?? fetch(data[0].url) (hosted
      // link). Defensive regardless of which the API sends back.
      const first = json?.data?.[0];
      let bytes: ArrayBuffer = new ArrayBuffer(0);
      let mime = "image/png";
      if (first?.b64_json) {
        bytes = base64ToArrayBuffer(first.b64_json);
      } else if (first?.url) {
        const imageResponse = await fetchWithTimeout(
          first.url,
          { method: "GET" },
          timeoutMs,
          fetchImpl,
        );
        if (!imageResponse.ok) {
          throw new Error(
            `OpenAI image fetch failed: status=${imageResponse.status}`,
          );
        }
        bytes = await imageResponse.arrayBuffer();
        mime = imageResponse.headers.get("content-type") ?? "image/png";
      }
      return {
        bytes,
        mime,
        model,
        retries,
        status: response.status,
      };
    },
  };
}
