import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";
import { createOpenAIClient } from "../src/ai/openai-client";
import type {
  OpenAIClient,
  GenerateImageResult,
} from "../src/ai/openai-client";
import type { AiGenerationRow } from "../src/ai/generation-log";
import {
  buildAiStorageKey,
  generateFeatureImage,
  generateFeatureImagePrompt,
  generateLogoImage,
  generateLogoPrompt,
} from "../src/ai/generators/image";

// T8: Image generators. Behavioural ACs:
// - GIVEN no OPENAI_API_KEY WHEN generateLogoImage is called THEN it
//   returns { status: 'skipped_no_api_key', media_id: <placeholder> }.
// - GIVEN generateFeatureImage succeeds WHEN the media row is inserted
//   THEN the row contains both site_id and ai_generation_id.
// - GIVEN generateLogoImage runs THEN the storage_key written to R2 is
//   deterministic given the same site_id + generation context.

interface CapturedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run";
}

interface MediaRow {
  id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string | null;
  folder: string | null;
  site_id: string | null;
  ai_generation_id: string | null;
}

function makeFakeDb() {
  const calls: CapturedCall[] = [];
  const ai = new Map<string, AiGenerationRow>();
  const media: MediaRow[] = [];
  let nextMediaId = 1;

  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        calls.push({ sql, binds: captured, kind: "first" });
        if (sql.startsWith("SELECT") && sql.includes("FROM ai_generations")) {
          const key = String(captured[0] ?? "");
          const row = ai.get(key);
          return (row ?? null) as T | null;
        }
        if (sql.startsWith("INSERT INTO media")) {
          const [
            filename,
            storage_key,
            mime_type,
            size_bytes,
            alt_text,
            folder,
            site_id,
            ai_generation_id,
          ] = captured as [
            string,
            string,
            string,
            number,
            string | null,
            string | null,
            string | null,
            string | null,
          ];
          const id = nextMediaId++;
          media.push({
            id,
            filename,
            storage_key,
            mime_type,
            size_bytes,
            alt_text,
            folder,
            site_id,
            ai_generation_id,
          });
          return { id } as unknown as T;
        }
        return null;
      },
      async run(): Promise<{ success: true }> {
        calls.push({ sql, binds: captured, kind: "run" });
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
        } else if (
          sql.startsWith("UPDATE ai_generations SET status = 'success'")
        ) {
          const [response_json, parsed_json, target_type, target_id, key] =
            captured as [string, string, string | null, string | null, string];
          const row = ai.get(key);
          if (row) {
            row.status = "success";
            row.response_json = response_json;
            row.parsed_json = parsed_json;
            row.target_type = target_type ?? row.target_type;
            row.target_id = target_id ?? row.target_id;
          }
        } else if (
          sql.startsWith("UPDATE ai_generations SET status = 'failed'")
        ) {
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
          sql.startsWith("UPDATE ai_generations SET status = 'fallback'")
        ) {
          const [parsed_json, target_type, target_id, error_message, key] =
            captured as [
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
            row.target_type = target_type ?? row.target_type;
            row.target_id = target_id ?? row.target_id;
            row.error_message = error_message;
          }
        }
        return { success: true };
      },
    };
    return stmt;
  };
  return { prepare, calls, ai, media };
}

interface R2Entry {
  body: ArrayBuffer;
  contentType?: string;
}

function makeFakeR2() {
  const store = new Map<string, R2Entry>();
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array,
      opts?: { httpMetadata?: { contentType?: string } },
    ) {
      const buf: ArrayBuffer =
        value instanceof Uint8Array
          ? (value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            ) as ArrayBuffer)
          : value;
      store.set(key, { body: buf, contentType: opts?.httpMetadata?.contentType });
      return { key };
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as R2Bucket;
  return { bucket, store };
}

function makeEnv(opts: { apiKey?: string } = {}) {
  const db = makeFakeDb();
  const r2 = makeFakeR2();
  const env = {
    DB: { prepare: db.prepare } as unknown as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: r2.bucket,
    APP_ENV: "test",
    ADMIN_HOST: "admin.example",
    ADMIN_BASE_URL: "https://admin.example",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    OPENAI_API_KEY: opts.apiKey,
  } as Env;
  return { env, calls: db.calls, ai: db.ai, media: db.media, r2: r2.store };
}

function noKeyClient(): OpenAIClient {
  return {
    hasApiKey: () => false,
    async generateText() {
      return { skipped_no_api_key: true };
    },
    async generateImage() {
      return { skipped_no_api_key: true };
    },
  };
}

function pngBytes(label: string): ArrayBuffer {
  const buf = new TextEncoder().encode(`PNG_BYTES_${label}`);
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

function imageSuccessClient(label: string): OpenAIClient {
  const result: GenerateImageResult = {
    bytes: pngBytes(label),
    mime: "image/png",
    model: "gpt-image-2",
    retries: 0,
    status: 200,
  };
  return {
    hasApiKey: () => true,
    async generateText() {
      return {
        text: "ok",
        model: "gpt-5.5",
        retries: 0,
        status: 200,
      };
    },
    async generateImage() {
      return result;
    },
  };
}

describe("T8 image generators — no OPENAI_API_KEY path", () => {
  it("generateLogoImage: returns { status: 'skipped_no_api_key', media_id: 0 } and writes an ai_generations row", async () => {
    const { env, ai, media, r2 } = makeEnv();
    const result = await generateLogoImage(env, {
      site_id: "site-alpha",
      vertical: "personal finance",
      brand_name: "MoneyClear",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.media_id).toBe(0);
    expect(result.storage_key.length).toBeGreaterThan(0);
    // No R2 PUT in the skipped path.
    expect(r2.size).toBe(0);
    // No media row in the skipped path.
    expect(media.length).toBe(0);
    // ai_generations row exists.
    const row = ai.get(result.idempotency_key);
    expect(row).toBeDefined();
    expect(row?.task).toBe("logo-image");
  });

  it("generateFeatureImage: returns placeholder media_id when no API key", async () => {
    const { env, media, r2 } = makeEnv();
    const result = await generateFeatureImage(env, {
      site_id: "site-alpha",
      vertical: "personal finance",
      article_title: "Getting started with budgeting",
      article_slug: "getting-started",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.media_id).toBe(0);
    expect(r2.size).toBe(0);
    expect(media.length).toBe(0);
  });
});

describe("T8 image generators — success path inserts media row with site_id + ai_generation_id", () => {
  it("generateFeatureImage: writes R2 + media row containing site_id AND ai_generation_id", async () => {
    const { env, ai, media, r2 } = makeEnv({ apiKey: "sk-livefakekey1234" });
    const client = imageSuccessClient("feature-1");
    const result = await generateFeatureImage(env, {
      site_id: "site-success",
      vertical: "home gardening",
      article_title: "Indoor herb gardens",
      article_slug: "indoor-herb-gardens",
      client,
    });
    expect(result.status).toBe("success");
    expect(result.media_id).toBeGreaterThan(0);
    // R2 actually written.
    expect(r2.size).toBe(1);
    const r2Entry = Array.from(r2.entries())[0];
    expect(r2Entry).toBeDefined();
    expect(r2Entry?.[0]).toBe(result.storage_key);
    expect(r2Entry?.[1].contentType).toBe("image/png");
    // Media row carries BOTH site_id and ai_generation_id.
    expect(media.length).toBe(1);
    const row = media[0]!;
    expect(row.site_id).toBe("site-success");
    expect(row.ai_generation_id).toBe(result.ai_generation_id);
    expect(row.storage_key).toBe(result.storage_key);
    expect(row.mime_type).toBe("image/png");
    // ai_generations row reached 'success' status.
    const aiRow = ai.get(result.idempotency_key);
    expect(aiRow?.status).toBe("success");
  });

  it("generateLogoImage: also writes media row with site_id + ai_generation_id on success", async () => {
    const { env, media } = makeEnv({ apiKey: "sk-livefakekey5678" });
    const client = imageSuccessClient("logo-1");
    const result = await generateLogoImage(env, {
      site_id: "site-logo",
      vertical: "podcasting",
      brand_name: "IndieCast",
      client,
    });
    expect(result.status).toBe("success");
    expect(media.length).toBe(1);
    const row = media[0]!;
    expect(row.site_id).toBe("site-logo");
    expect(row.ai_generation_id).toBe(result.ai_generation_id);
  });
});

describe("T8 deterministic storage_key", () => {
  it("buildAiStorageKey: same site_id + target_kind + target_id => same R2 key", () => {
    const a = buildAiStorageKey({
      site_id: "site-x",
      target_kind: "logo",
      target_id: "default",
    });
    const b = buildAiStorageKey({
      site_id: "site-x",
      target_kind: "logo",
      target_id: "default",
    });
    const c = buildAiStorageKey({
      site_id: "site-y",
      target_kind: "logo",
      target_id: "default",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^ai\/site-x\/logo\//);
  });

  it("generateLogoImage produces a deterministic storage_key for the same site_id + context", async () => {
    const a = await generateLogoImage(makeEnv().env, {
      site_id: "site-det",
      vertical: "cycling",
      brand_name: "RideBetter",
      client: noKeyClient(),
    });
    const b = await generateLogoImage(makeEnv().env, {
      site_id: "site-det",
      vertical: "cycling",
      brand_name: "RideBetter",
      client: noKeyClient(),
    });
    expect(a.storage_key).toBe(b.storage_key);
  });
});

describe("T8 idempotency contract", () => {
  it("generateFeatureImage called twice with the same (site_id, article_slug) returns same media_id and inserts only one media row", async () => {
    const { env, media, r2 } = makeEnv({ apiKey: "sk-livefakekey9999" });
    const client = imageSuccessClient("idempotent");
    const first = await generateFeatureImage(env, {
      site_id: "site-idem",
      vertical: "personal finance",
      article_title: "First pass",
      article_slug: "first-pass",
      client,
    });
    const second = await generateFeatureImage(env, {
      site_id: "site-idem",
      vertical: "personal finance",
      article_title: "First pass",
      article_slug: "first-pass",
      client,
    });
    expect(second.ai_generation_id).toBe(first.ai_generation_id);
    expect(second.media_id).toBe(first.media_id);
    expect(media.length).toBe(1);
    // R2 should only have one key for this generation.
    expect(r2.size).toBe(1);
  });
});

describe("T8 prompt generators", () => {
  it("generateLogoPrompt returns GeneratedImagePrompt with target_kind='logo'", async () => {
    const { env } = makeEnv();
    const result = await generateLogoPrompt(env, {
      site_id: "site-p",
      vertical: "personal finance",
      brand_name: "ExamplePub",
      client: noKeyClient(),
    });
    expect(result.parsed.target_kind).toBe("logo");
    expect(result.parsed.prompt.length).toBeGreaterThan(0);
    expect(result.parsed.size).toBe("1024x1024");
  });

  it("generateFeatureImagePrompt returns GeneratedImagePrompt with target_kind='feature_image'", async () => {
    const { env } = makeEnv();
    const result = await generateFeatureImagePrompt(env, {
      site_id: "site-q",
      vertical: "home gardening",
      article_title: "Indoor herbs",
      article_slug: "indoor-herbs",
      client: noKeyClient(),
    });
    expect(result.parsed.target_kind).toBe("feature_image");
    expect(result.parsed.prompt).toMatch(/Indoor herbs/);
  });
});

describe("T10 image-response parsing — b64_json AND url via the real OpenAI client (AC2)", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  // L2_AUTO_DISAMBIGUATION:T10-AC2:RC-027 [api/test/ai-generators-image.test.ts]
  it("createOpenAIClient.generateImage returns image bytes for BOTH a b64_json response AND a url response (data[0].b64_json ?? fetch(data[0].url)) [api/test/ai-generators-image.test.ts] L2_AUTO_DISAMBIGUATION:T10-AC2:RC-027", async () => {
    const { env } = makeEnv({ apiKey: "sk-livefake-ac2" });

    // --- shape 1: inline base64 (data[0].b64_json) — "hi" ---
    const b64Fetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: [{ b64_json: "aGk=" }] }));
    const b64Result = await createOpenAIClient(env).generateImage({
      prompt: "feature image",
      fetchImpl: b64Fetch as unknown as typeof fetch,
    });
    if ("skipped_no_api_key" in b64Result && b64Result.skipped_no_api_key) {
      throw new Error("expected image bytes from the b64_json shape");
    }
    // Inline base64 needs no follow-on URL fetch.
    expect(b64Fetch).toHaveBeenCalledTimes(1);
    expect(b64Result.bytes.byteLength).toBe(2);

    // --- shape 2: hosted url (data[0].url) ---
    const hostedBytes = new TextEncoder().encode("PNG_BYTES_FROM_URL");
    const urlFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ data: [{ url: "https://img.example/feature.png" }] }),
      )
      .mockResolvedValueOnce(
        new Response(hostedBytes, {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );
    const urlResult = await createOpenAIClient(env).generateImage({
      prompt: "feature image",
      fetchImpl: urlFetch as unknown as typeof fetch,
    });
    if ("skipped_no_api_key" in urlResult && urlResult.skipped_no_api_key) {
      throw new Error("expected image bytes from the url shape");
    }
    // generations endpoint call + a follow-on GET to the hosted url.
    expect(urlFetch).toHaveBeenCalledTimes(2);
    expect(urlFetch.mock.calls[1]?.[0]).toBe("https://img.example/feature.png");
    expect(urlResult.bytes.byteLength).toBe(hostedBytes.byteLength);
    expect(urlResult.mime).toBe("image/png");
  });
});
