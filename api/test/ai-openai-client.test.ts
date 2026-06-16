import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";
import {
  createOpenAIClient,
  redactApiKey,
  redactSecretsFromText,
} from "../src/ai/openai-client";

function makeEnv(overrides: Partial<Env> = {}): Env {
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
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("T2 OpenAI client", () => {
  describe("createOpenAIClient + generateText", () => {
    it("returns { skipped_no_api_key: true } when env.OPENAI_API_KEY is unset", async () => {
      const env = makeEnv({ OPENAI_API_KEY: undefined });
      const client = createOpenAIClient(env);
      expect(client.hasApiKey()).toBe(false);
      const result = await client.generateText({ prompt: "hello" });
      expect(result).toEqual({ skipped_no_api_key: true });
    });

    it("returns { skipped_no_api_key: true } when env.OPENAI_API_KEY is empty", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "   " });
      const client = createOpenAIClient(env);
      const result = await client.generateText({ prompt: "hello" });
      expect(result).toEqual({ skipped_no_api_key: true });
    });

    it("retries once on 429 and then succeeds with retries=1", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ error: "rate" }, 429))
        .mockResolvedValueOnce(
          jsonResponse({
            choices: [{ message: { content: "ok" } }],
          }),
        );
      const client = createOpenAIClient(env);
      const result = await client.generateText({
        prompt: "p",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected success result");
      }
      expect(result.text).toBe("ok");
      expect(result.retries).toBe(1);
      expect(result.model).toBe("gpt-5.5");
    });

    it("succeeds on first try with retries=0", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          jsonResponse({
            choices: [{ message: { content: "first-try" } }],
          }),
        );
      const client = createOpenAIClient(env);
      const result = await client.generateText({
        prompt: "p",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected success result");
      }
      expect(result.retries).toBe(0);
      expect(result.text).toBe("first-try");
    });

    it("throws after final retry when status remains 429", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ error: "rate" }, 429));
      const client = createOpenAIClient(env);
      await expect(
        client.generateText({
          prompt: "p",
          maxRetries: 1,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/OpenAI text request failed: status=429/);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("sends Bearer authorization header and JSON content-type", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({ choices: [{ message: { content: "hi" } }] }),
      );
      const client = createOpenAIClient(env);
      await client.generateText({
        prompt: "p",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const call = fetchImpl.mock.calls[0];
      if (!call) throw new Error("expected at least one fetch call");
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["authorization"]).toBe("Bearer sk-test-real-key");
      expect(headers["content-type"]).toBe("application/json");
      expect(init.signal).toBeDefined();
    });
  });

  describe("redaction", () => {
    it("redactApiKey returns [REDACTED] for an sk- key", () => {
      expect(redactApiKey("sk-abc123def456ghij")).toBe("[REDACTED]");
    });

    it("redactApiKey returns [REDACTED] for undefined", () => {
      expect(redactApiKey(undefined)).toBe("[REDACTED]");
    });

    it("redactSecretsFromText replaces sk-abc123 with [REDACTED]", () => {
      const input = "prompt context: sk-abc123def456 trailing text";
      const output = redactSecretsFromText(input);
      expect(output).not.toContain("sk-abc123");
      expect(output).toContain("[REDACTED]");
    });

    it("redactSecretsFromText preserves text without secrets", () => {
      const input = "no secret here";
      expect(redactSecretsFromText(input)).toBe(input);
    });

    it("redactSecretsFromText scrubs error messages so logs never leak the key", () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-abc123def456ghij" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            "auth failed for key sk-abc123def456ghij at upstream",
            { status: 401 },
          ),
        );
      const client = createOpenAIClient(env);
      return expect(
        client.generateText({
          prompt: "p",
          maxRetries: 0,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/\[REDACTED\]/);
    });
  });

  describe("generateImage", () => {
    it("returns skipped_no_api_key when env has no key", async () => {
      const env = makeEnv({ OPENAI_API_KEY: undefined });
      const client = createOpenAIClient(env);
      const result = await client.generateImage({ prompt: "logo" });
      expect(result).toEqual({ skipped_no_api_key: true });
    });

    it("decodes b64_json into an ArrayBuffer", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-real" });
      // base64 for "hi"
      const b64 = "aGk=";
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: b64 }] }));
      const client = createOpenAIClient(env);
      const result = await client.generateImage({
        prompt: "logo",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected image bytes");
      }
      expect(result.bytes.byteLength).toBe(2);
      expect(result.mime).toBe("image/png");
      expect(result.model).toBe("gpt-image-2");
    });
  });

  describe("T10 generateImage fix — request shape + response shapes", () => {
    // L2_AUTO_DISAMBIGUATION:T10-AC1:RC-026 [api/test/ai-openai-client.test.ts]
    it("AC1: serialized request body contains NO response_format key (gpt-image-2 rejects it) [api/test/ai-openai-client.test.ts] L2_AUTO_DISAMBIGUATION:T10-AC1:RC-026", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-real" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: "aGk=" }] }));
      const client = createOpenAIClient(env);
      await client.generateImage({
        prompt: "logo",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const call = fetchImpl.mock.calls[0];
      if (!call) throw new Error("expected a fetch call");
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect("response_format" in body).toBe(false);
      expect(Object.keys(body)).not.toContain("response_format");
      // The model id is locked by the brief and stays unchanged.
      expect(body.model).toBe("gpt-image-2");
    });

    it("AC2: parses a b64_json response into image bytes (data[0].b64_json)", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-real" });
      // base64 for "hi"
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: "aGk=" }] }));
      const client = createOpenAIClient(env);
      const result = await client.generateImage({
        prompt: "logo",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected image bytes");
      }
      // Only the generations endpoint is hit; no follow-on URL fetch.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.bytes.byteLength).toBe(2);
      expect(result.mime).toBe("image/png");
    });

    it("AC2: parses a url response by fetching the hosted image bytes (data[0].url)", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-real" });
      const imageBytes = new TextEncoder().encode("PNG_BYTES_FROM_URL");
      const fetchImpl = vi
        .fn<typeof fetch>()
        // 1st call: generations endpoint returns a URL (no b64_json).
        .mockResolvedValueOnce(
          jsonResponse({ data: [{ url: "https://img.example/abc.png" }] }),
        )
        // 2nd call: fetching that URL returns the raw image bytes.
        .mockResolvedValueOnce(
          new Response(imageBytes, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
        );
      const client = createOpenAIClient(env);
      const result = await client.generateImage({
        prompt: "logo",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected image bytes");
      }
      // The hosted URL is fetched as a follow-on GET.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://img.example/abc.png");
      const secondInit = fetchImpl.mock.calls[1]?.[1] as RequestInit;
      expect(secondInit.method).toBe("GET");
      expect(result.bytes.byteLength).toBe(imageBytes.byteLength);
      expect(result.mime).toBe("image/png");
    });

    it("AC2: prefers b64_json over url when both are present (b64_json ?? url)", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-real" });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
        jsonResponse({
          data: [{ b64_json: "aGk=", url: "https://img.example/should-not-fetch.png" }],
        }),
      );
      const client = createOpenAIClient(env);
      const result = await client.generateImage({
        prompt: "logo",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected image bytes");
      }
      // b64_json wins; the url is never fetched.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result.bytes.byteLength).toBe(2);
    });
  });

  describe("T11 retry on timeout/abort — not just 429/5xx", () => {
    function abortError(message = "The operation was aborted"): Error {
      const e = new Error(message);
      e.name = "AbortError";
      return e;
    }

    // T11-AC2: a timed-out / aborted call is added to the retriable set
    // alongside isRetriableStatus 429/5xx, so a slow generation is retried
    // rather than surfaced immediately as a fallback stub.
    it("AC2: retries an aborted/timed-out request then succeeds (retries=1) [api/test/ai-openai-client.test.ts] L2_AUTO_DISAMBIGUATION:T11-AC2:RC-029", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        // 1st call: aborts (timeout) — must be retried, NOT dropped to fallback.
        .mockRejectedValueOnce(abortError("The operation was aborted due to timeout"))
        // 2nd call: succeeds.
        .mockResolvedValueOnce(
          jsonResponse({ choices: [{ message: { content: "recovered" } }] }),
        );
      const client = createOpenAIClient(env);
      const result = await client.generateText({
        prompt: "p",
        maxRetries: 1,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      if ("skipped_no_api_key" in result && result.skipped_no_api_key) {
        throw new Error("expected success result");
      }
      expect(result.text).toBe("recovered");
      expect(result.retries).toBe(1);
    });

    it("AC2: rethrows the abort after exhausting retries (bounded)", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockRejectedValue(abortError("aborted"));
      const client = createOpenAIClient(env);
      await expect(
        client.generateText({
          prompt: "p",
          maxRetries: 1,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/abort/i);
      // initial attempt + one retry = 2 calls, then it gives up.
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("AC2: does NOT retry a non-abort/non-status error (scope is timeout/abort only)", async () => {
      const env = makeEnv({ OPENAI_API_KEY: "sk-test-real-key" });
      const networkErr = new Error("Failed to fetch");
      networkErr.name = "TypeError";
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockRejectedValue(networkErr);
      const client = createOpenAIClient(env);
      await expect(
        client.generateText({
          prompt: "p",
          maxRetries: 1,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      ).rejects.toThrow(/Failed to fetch/);
      // No retry for a generic error — surfaced immediately.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});
