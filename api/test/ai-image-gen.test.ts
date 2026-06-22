import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";
import { createOpenAIClient } from "../src/ai/openai-client";
import type { OpenAIClient } from "../src/ai/openai-client";
import type { AiGenerationRow } from "../src/ai/generation-log";
import { generateFeatureImage } from "../src/ai/generators/image";

// T1: AI image generation hardening — behavioural ACs.
//
// - AC1 (RC-002): the image generation path resolves a timeout ≥120000ms
//   (not the 30s text default). Proven with fake timers: the request must
//   survive past 30s and abort exactly at the 120s image budget.
// - AC2 (RC-003): a requested 1792x1024 (a DALL·E-era size gpt-image-2
//   rejects) is normalized to a supported size BEFORE the request body
//   reaches the OpenAI client; the unsupported size never appears on the
//   wire.
// - AC3 (RC-004): an image failure with a key present surfaces as
//   failed/retryable (status='failed', media_id 0, no media row), NEVER a
//   silent 'fallback' stub; the locked model id stays gpt-image-2.

function baseEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  } as Env;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Minimal fake D1 + R2 for the generator-level AC3 test: tracks the
// ai_generations receipt row, media inserts, and R2 puts.
interface MediaRow {
  id: number;
  site_id: string | null;
  ai_generation_id: string | null;
  storage_key: string;
}

function makeImageEnv(opts: { apiKey?: string } = {}) {
  const ai = new Map<string, AiGenerationRow>();
  const media: MediaRow[] = [];
  const r2 = new Map<string, ArrayBuffer>();
  let nextMediaId = 1;

  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        if (sql.startsWith("SELECT") && sql.includes("FROM ai_generations")) {
          return (ai.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        if (sql.startsWith("INSERT INTO media")) {
          const id = nextMediaId++;
          media.push({
            id,
            site_id: (captured[6] as string | null) ?? null,
            ai_generation_id: (captured[7] as string | null) ?? null,
            storage_key: String(captured[1] ?? ""),
          });
          return { id } as unknown as T;
        }
        return null;
      },
      async run(): Promise<{ success: true }> {
        if (sql.startsWith("INSERT INTO ai_generations")) {
          const [
            id,
            site_id,
            task,
            provider,
            model,
            prompt_version,
            idempotency_key,
            request_json,
            target_type,
            target_id,
          ] = captured as [
            string,
            string | null,
            string,
            string,
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
          ];
          if (!ai.has(idempotency_key)) {
            ai.set(idempotency_key, {
              id,
              site_id,
              task,
              provider,
              model,
              prompt_version,
              idempotency_key,
              request_json,
              response_json: null,
              parsed_json: null,
              status: "pending",
              target_type,
              target_id,
              error_message: null,
              created_at: 1,
              updated_at: 1,
            });
          }
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'failed'")) {
          const [response_json, error_message, key] = captured as [
            string,
            string,
            string,
          ];
          const row = ai.get(key);
          if (row) {
            row.status = "failed";
            row.response_json = response_json;
            row.error_message = error_message;
          }
        } else if (
          sql.startsWith("UPDATE ai_generations SET status = 'success'")
        ) {
          const [response_json, parsed_json, , , key] = captured as [
            string,
            string,
            string | null,
            string | null,
            string,
          ];
          const row = ai.get(key);
          if (row) {
            row.status = "success";
            row.response_json = response_json;
            row.parsed_json = parsed_json;
          }
        } else if (
          sql.startsWith("UPDATE ai_generations SET status = 'fallback'")
        ) {
          const [parsed_json, , , error_message, key] = captured as [
            string,
            string | null,
            string | null,
            string | null,
            string,
          ];
          const row = ai.get(key);
          if (row) {
            row.status = "fallback";
            row.parsed_json = parsed_json;
            row.error_message = error_message;
          }
        }
        return { success: true };
      },
    };
    return stmt;
  };

  const bucket = {
    async put(key: string, value: ArrayBuffer) {
      r2.set(key, value);
      return { key };
    },
  } as unknown as R2Bucket;

  const env = baseEnv({
    DB: { prepare } as unknown as D1Database,
    MEDIA: bucket,
    OPENAI_API_KEY: opts.apiKey,
  });
  return { env, ai, media, r2 };
}

describe("T1 AI image generation hardening", () => {
  // L2_AUTO_DISAMBIGUATION:T1-AC1:RC-002 [api/test/ai-image-gen.test.ts]
  it("AC1: the image path uses a >=120000ms timeout — survives past 30s and aborts at 120s, not the 30s text default [api/test/ai-image-gen.test.ts] L2_AUTO_DISAMBIGUATION:T1-AC1:RC-002", async () => {
    vi.useFakeTimers();
    try {
      const env = baseEnv({ OPENAI_API_KEY: "sk-real" });
      let capturedSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            capturedSignal = init?.signal ?? undefined;
            init?.signal?.addEventListener("abort", () => {
              const e = new Error("The operation was aborted due to timeout");
              e.name = "AbortError";
              reject(e);
            });
          }),
      );
      const client = createOpenAIClient(env);
      const pending = client.generateImage({
        prompt: "logo",
        // maxRetries 0 so the abort propagates without a retry sleep.
        maxRetries: 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const settled = pending.then(
        () => "resolved",
        (e: unknown) => `rejected:${(e as Error).name}`,
      );

      // The 30s text default would have aborted by now; the image path holds.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(capturedSignal).toBeDefined();
      expect(capturedSignal?.aborted ?? false).toBe(false);

      // Still in flight one millisecond before the 120s image budget.
      await vi.advanceTimersByTimeAsync(89_999); // total 119_999ms
      expect(capturedSignal?.aborted ?? false).toBe(false);

      // The image budget fires exactly at 120000ms.
      await vi.advanceTimersByTimeAsync(1); // total 120_000ms
      expect(capturedSignal?.aborted).toBe(true);
      expect(await settled).toBe("rejected:AbortError");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // L2_AUTO_DISAMBIGUATION:T1-AC2:RC-003 [api/test/ai-image-gen.test.ts]
  it("AC2: a requested 1792x1024 is normalized to a gpt-image-2-supported size; the unsupported size never reaches the client [api/test/ai-image-gen.test.ts] L2_AUTO_DISAMBIGUATION:T1-AC2:RC-003", async () => {
    const env = baseEnv({ OPENAI_API_KEY: "sk-real" });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: "aGk=" }] }));
    const client = createOpenAIClient(env);
    const result = await client.generateImage({
      prompt: "feature image",
      size: "1792x1024",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
      throw new Error("expected image bytes");
    }
    const call = fetchImpl.mock.calls[0];
    if (!call) throw new Error("expected a fetch call to the image endpoint");
    const body = JSON.parse((call[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    const supported = ["1024x1024", "1536x1024", "1024x1536"];
    // The unsupported DALL·E size never reaches the OpenAI client...
    expect(body.size).not.toBe("1792x1024");
    // ...it is normalized to a supported gpt-image-2 size (16:9 → landscape).
    expect(supported).toContain(body.size);
    expect(body.size).toBe("1536x1024");
    // The model id is locked and unchanged.
    expect(body.model).toBe("gpt-image-2");
  });

  // L2_AUTO_DISAMBIGUATION:T1-AC3:RC-004 [api/test/ai-image-gen.test.ts]
  it("AC3: an image failure with a key present surfaces as failed/retryable, not a silent fallback with 0 media; model stays gpt-image-2 [api/test/ai-image-gen.test.ts] L2_AUTO_DISAMBIGUATION:T1-AC3:RC-004", async () => {
    const { env, ai, media, r2 } = makeImageEnv({ apiKey: "sk-livefakekey1234" });
    const failingClient: OpenAIClient = {
      hasApiKey: () => true,
      async generateText() {
        return { text: "", model: "gpt-5.5", retries: 0, status: 200 };
      },
      async generateImage() {
        // A real upstream failure while a key IS present.
        throw new Error("OpenAI image request failed: status=500");
      },
    };
    const result = await generateFeatureImage(env, {
      site_id: "site-fail",
      vertical: "personal finance",
      article_title: "Failing image",
      article_slug: "failing-image",
      client: failingClient,
    });
    // Surfaces as failed/retryable — NEVER a silent 'fallback' stub.
    expect(result.status).toBe("failed");
    expect(result.status).not.toBe("fallback");
    expect(result.media_id).toBe(0);
    // No media row and no R2 object — the failure is reported, not papered over.
    expect(media.length).toBe(0);
    expect(r2.size).toBe(0);
    // The ai_generations receipt records 'failed' and keeps the locked model id.
    const row = ai.get(result.idempotency_key);
    expect(row?.status).toBe("failed");
    expect(row?.model).toBe("gpt-image-2");
  });
});

describe("PR-2b image retry-on-empty", () => {
  // An empty 200 (no b64_json, no url) is a transient empty render: the image
  // path retries (ceiling 2) and succeeds on a later non-empty response rather
  // than returning a 0-byte ArrayBuffer.
  it("retries an empty 200 image response then succeeds with real bytes", async () => {
    const env = baseEnv({ OPENAI_API_KEY: "sk-real" });
    const fetchImpl = vi
      .fn<typeof fetch>()
      // 1st: 200 but no data → empty result, retriable.
      .mockResolvedValueOnce(jsonResponse({ data: [{}] }))
      // 2nd: 200 with real bytes ("hi" = 2 bytes).
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: "aGk=" }] }));
    const client = createOpenAIClient(env);
    const result = await client.generateImage({
      prompt: "feature image",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
      throw new Error("expected image bytes after retry");
    }
    // initial empty attempt + one retry that succeeds.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.bytes.byteLength).toBe(2);
    expect(result.retries).toBe(1);
  });

  // When EVERY attempt is empty, the image path exhausts its retries (default
  // ceiling 2 → 3 attempts) and THROWS rather than returning 0 bytes.
  it("throws after exhausting retries when every image response is empty (no 0-byte success)", async () => {
    const env = baseEnv({ OPENAI_API_KEY: "sk-real" });
    // A FRESH empty 200 Response per call (each fetch in the retry loop gets its
    // own response, exactly as the real OpenAI endpoint returns one per request).
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({ data: [{}] }));
    const client = createOpenAIClient(env);
    await expect(
      client.generateImage({
        prompt: "feature image",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no image bytes/i);
    // default image ceiling is 2 retries → 3 total attempts, then it gives up.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  // generateFeatureImage records a failed/retriable receipt (NOT a 0-byte media
  // row marked success) when the client yields an empty result it cannot fill.
  it("generateFeatureImage records failed + inserts no media when the image is empty after retries", async () => {
    const { env, ai, media, r2 } = makeImageEnv({ apiKey: "sk-livefakekey0000" });
    const emptyClient: OpenAIClient = {
      hasApiKey: () => true,
      async generateText() {
        return { text: "", model: "gpt-5.5", retries: 0, status: 200 };
      },
      // A 0-byte buffer that slips past the client (defensive guard in
      // runImageGenerator must catch it).
      async generateImage() {
        return {
          bytes: new ArrayBuffer(0),
          mime: "image/png",
          model: "gpt-image-2",
          retries: 2,
          status: 200,
        };
      },
    };
    const result = await generateFeatureImage(env, {
      site_id: "site-empty",
      vertical: "personal finance",
      article_title: "Empty image",
      article_slug: "empty-image",
      client: emptyClient,
    });
    expect(result.status).toBe("failed");
    expect(result.media_id).toBe(0);
    expect(media.length).toBe(0);
    expect(r2.size).toBe(0);
    const row = ai.get(result.idempotency_key);
    expect(row?.status).toBe("failed");
  });
});
