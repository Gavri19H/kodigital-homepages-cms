import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";
import type { OpenAIClient } from "../src/ai/openai-client";
import type { AiGenerationRow } from "../src/ai/generation-log";
import {
  computeIdempotencyKey,
  generateAboutPage,
  generateArticleSEO,
  generateImageAltText,
  generateSiteDescription,
  generateSiteTagline,
  generateStarterArticle,
  generateStarterArticlePlan,
} from "../src/ai/generators/text";

// T7: Text generators (tagline / description / about / plan / article / SEO
// / alt-text). The behavioural ACs we assert here:
//   - GIVEN no OPENAI_API_KEY THEN generateSiteTagline returns non-empty
//     fallback with status='skipped_no_api_key'.
//   - GIVEN no OPENAI_API_KEY THEN generateStarterArticlePlan returns
//     exactly 15 items with unique slugs.
//   - GIVEN generateStarterArticle is called twice with the same
//     (site_id, slug), the second call returns the same ai_generation_id
//     without creating a duplicate ai_generations row.
//
// We mock both env.DB (the D1 layer) and the OpenAIClient so we can
// observe the SQL writes and assert idempotency.

interface CapturedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run";
}

function makeFakeDb(initial: Record<string, AiGenerationRow | null> = {}) {
  const calls: CapturedCall[] = [];
  const store = new Map<string, AiGenerationRow>();
  for (const [k, v] of Object.entries(initial)) {
    if (v) store.set(k, v);
  }

  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T>(): Promise<T | null> {
        calls.push({ sql, binds: captured, kind: "first" });
        const key = String(captured[0] ?? "");
        const row = store.get(key);
        return (row ?? null) as T | null;
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
          if (!store.has(idempotency_key)) {
            store.set(idempotency_key, {
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
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'success'")) {
          const [response_json, parsed_json, target_type, target_id, key] =
            captured as [string, string, string | null, string | null, string];
          const row = store.get(key);
          if (row) {
            row.status = "success";
            row.response_json = response_json;
            row.parsed_json = parsed_json;
            row.target_type = target_type ?? row.target_type;
            row.target_id = target_id ?? row.target_id;
            row.updated_at = row.updated_at + 1;
          }
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'failed'")) {
          const [response_json, error_message, key] = captured as [
            string,
            string,
            string,
          ];
          const row = store.get(key);
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
          const row = store.get(key);
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
  return { prepare, calls, store };
}

function makeEnv(opts: { apiKey?: string } = {}): {
  env: Env;
  calls: CapturedCall[];
  store: Map<string, AiGenerationRow>;
} {
  const db = makeFakeDb();
  const env = {
    DB: { prepare: db.prepare } as unknown as D1Database,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
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
  return { env, calls: db.calls, store: db.store };
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

function successClient(text: string): OpenAIClient {
  return {
    hasApiKey: () => true,
    async generateText() {
      return {
        text,
        model: "gpt-5.5",
        retries: 0,
        status: 200,
      };
    },
    async generateImage() {
      return { skipped_no_api_key: true };
    },
  };
}

describe("T7 text generators — fallback without OPENAI_API_KEY", () => {
  it("generateSiteTagline: returns non-empty fallback string with status='skipped_no_api_key'", async () => {
    const { env, store } = makeEnv();
    const result = await generateSiteTagline(env, {
      site_id: "site-a",
      vertical: "personal finance",
      audience: "first-time savers",
      brand_name: "MoneyClear",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.tagline.length).toBeGreaterThan(0);
    expect(result.ai_generation_id.length).toBeGreaterThan(0);
    const row = store.get(result.idempotency_key);
    expect(row).toBeDefined();
    // The DB row reflects the fallback write path (fallback or
    // skipped_no_api_key per the migration check constraint). The
    // *function return* explicitly carries status='skipped_no_api_key'.
    expect(["fallback", "skipped_no_api_key"]).toContain(row?.status);
  });

  it("generateSiteDescription: returns non-empty fallback when no API key", async () => {
    const { env } = makeEnv();
    const result = await generateSiteDescription(env, {
      site_id: "site-b",
      vertical: "home gardening",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.description.length).toBeGreaterThan(20);
  });

  it("generateAboutPage: returns non-empty body when no API key", async () => {
    const { env } = makeEnv();
    const result = await generateAboutPage(env, {
      site_id: "site-c",
      vertical: "cycling",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.body.length).toBeGreaterThanOrEqual(3);
    expect(result.parsed.title.length).toBeGreaterThan(0);
  });

  it("generateStarterArticlePlan: returns exactly `count` (15) articles with unique slugs", async () => {
    const { env } = makeEnv();
    const result = await generateStarterArticlePlan(env, {
      site_id: "site-d",
      vertical: "podcasting",
      audience: "indie creators",
      count: 15,
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.items).toHaveLength(15);
    const slugs = new Set(result.parsed.items.map((i) => i.slug));
    expect(slugs.size).toBe(15);
    for (const item of result.parsed.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.summary.length).toBeGreaterThan(0);
    }
  });

  it("generateStarterArticlePlan: fallback yields EXACTLY `count` unique items for count=35 (knob, not hard-wired 15)", async () => {
    const { env } = makeEnv();
    const result = await generateStarterArticlePlan(env, {
      site_id: "site-d35",
      vertical: "podcasting",
      audience: "indie creators",
      count: 35,
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.items).toHaveLength(35);
    const slugs = new Set(result.parsed.items.map((i) => i.slug));
    expect(slugs.size).toBe(35);
    for (const item of result.parsed.items) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.summary.length).toBeGreaterThan(0);
    }
  });

  it("generateStarterArticle: produces a GeneratedArticle with >=3 h2 + >=3 FAQs", async () => {
    const { env } = makeEnv();
    const result = await generateStarterArticle(env, {
      site_id: "site-e",
      vertical: "personal finance",
      slug: "fallback-article-1",
      title: "Getting started with budgeting",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    const h2 = result.parsed.sections.filter((s) => s.heading.level === 2);
    expect(h2.length).toBeGreaterThanOrEqual(3);
    expect(result.parsed.faqs.length).toBeGreaterThanOrEqual(3);
    expect(result.parsed.slug).toBe("fallback-article-1");
  });

  it("generateArticleSEO: returns truncated meta_title + non-empty meta_description on fallback", async () => {
    const { env } = makeEnv();
    const result = await generateArticleSEO(env, {
      site_id: "site-f",
      vertical: "home gardening",
      article_slug: "getting-started",
      article_title:
        "A very, very long article title that absolutely exceeds 60 characters and must be truncated for SEO",
      article_intro: "Practical first steps for home gardeners.",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.meta_title.length).toBeLessThanOrEqual(60);
    expect(result.parsed.meta_description.length).toBeGreaterThan(0);
  });

  it("generateImageAltText: returns non-empty fallback for context_kind='feature_image'", async () => {
    const { env } = makeEnv();
    const result = await generateImageAltText(env, {
      site_id: "site-g",
      media_id: "media-xyz",
      context_kind: "feature_image",
      article_title: "How to start",
      vertical: "personal finance",
      client: noKeyClient(),
    });
    expect(result.status).toBe("skipped_no_api_key");
    expect(result.parsed.alt_text.length).toBeGreaterThan(0);
  });
});

describe("T7 idempotency contract", () => {
  it("generateStarterArticle('fallback-article-1', ...) called twice returns the same ai_generation_id and no duplicate insert", async () => {
    const { env, calls } = makeEnv();
    const client = noKeyClient();
    const first = await generateStarterArticle(env, {
      site_id: "site-x",
      vertical: "personal finance",
      slug: "fallback-article-1",
      title: "First pass",
      client,
    });
    const insertsAfterFirst = calls.filter(
      (c) =>
        c.kind === "run" && c.sql.startsWith("INSERT INTO ai_generations"),
    ).length;

    const second = await generateStarterArticle(env, {
      site_id: "site-x",
      vertical: "personal finance",
      slug: "fallback-article-1",
      title: "First pass",
      client,
    });
    const insertsAfterSecond = calls.filter(
      (c) =>
        c.kind === "run" && c.sql.startsWith("INSERT INTO ai_generations"),
    ).length;

    expect(second.ai_generation_id).toBe(first.ai_generation_id);
    expect(second.idempotency_key).toBe(first.idempotency_key);
    expect(insertsAfterSecond).toBe(insertsAfterFirst);
  });

  it("computeIdempotencyKey produces a stable, site-namespaced key", () => {
    const a = computeIdempotencyKey(
      "site-a",
      "starter-article",
      "starter-article:v1",
      "slug-1",
    );
    const b = computeIdempotencyKey(
      "site-a",
      "starter-article",
      "starter-article:v1",
      "slug-1",
    );
    const c = computeIdempotencyKey(
      "site-b",
      "starter-article",
      "starter-article:v1",
      "slug-1",
    );
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("site-a");
    expect(a).toContain("starter-article:v1");
    expect(a).toContain("slug-1");
  });
});

describe("T7 success path with OpenAI client mock", () => {
  it("generateSiteTagline: writes status='success' to ai_generations when client returns text", async () => {
    const { env, store } = makeEnv({ apiKey: "sk-livefakekey1234" });
    const client = successClient("Practical guides for everyday savers.");
    const result = await generateSiteTagline(env, {
      site_id: "site-y",
      vertical: "personal finance",
      client,
    });
    expect(result.status).toBe("success");
    expect(result.parsed.tagline).toBe(
      "Practical guides for everyday savers.",
    );
    const row = store.get(result.idempotency_key);
    expect(row?.status).toBe("success");
    // redactSecretsFromPayload protects the parsed_json from accidentally
    // logging sk- material that arrived in the model response.
    expect(row?.parsed_json ?? "").not.toMatch(/sk-livefakekey/);
  });

  it("generateStarterArticlePlan: writes parsed plan when model returns >=count items", async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      slug: `model-slug-${i + 1}`,
      title: `Model title ${i + 1}`,
      summary: `Model summary ${i + 1}`,
    }));
    const { env } = makeEnv({ apiKey: "sk-livefakekey2345" });
    const client = successClient(JSON.stringify({ items }));
    const result = await generateStarterArticlePlan(env, {
      site_id: "site-z",
      vertical: "podcasting",
      count: 15,
      client,
    });
    expect(result.status).toBe("success");
    expect(result.parsed.items).toHaveLength(15);
    expect(result.parsed.items[0]?.slug).toBe("model-slug-1");
  });

  it("generateStarterArticle: falls back to deterministic body when model returns invalid JSON", async () => {
    const { env } = makeEnv({ apiKey: "sk-livefakekey3456" });
    const client = successClient("not actually json");
    const result = await generateStarterArticle(env, {
      site_id: "site-q",
      vertical: "cycling",
      slug: "indoor-training",
      title: "Indoor cycling for beginners",
      client,
    });
    // Invalid JSON triggers the fallback path; status reported is 'fallback'.
    expect(result.status).toBe("fallback");
    const h2 = result.parsed.sections.filter((s) => s.heading.level === 2);
    expect(h2.length).toBeGreaterThanOrEqual(3);
    expect(result.parsed.faqs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("T11 reliable full-article generation — longer per-article timeout", () => {
  // The OpenAI client's DEFAULT_TIMEOUT_MS is 30_000ms. A full article needs
  // more, so it would otherwise be aborted at 30s.
  const DEFAULT_TIMEOUT_MS = 30_000;

  // T11-AC1: generateStarterArticle MUST pass a timeoutMs larger than the
  // 30_000ms DEFAULT_TIMEOUT_MS (using the existing timeoutMs knob) so a full
  // article is not aborted at 30s.
  it("AC1: generateStarterArticle calls the text client with timeoutMs > 30000 [api/test/ai-generators-text.test.ts] L2_AUTO_DISAMBIGUATION:T11-AC1:RC-028", async () => {
    const { env } = makeEnv({ apiKey: "sk-livefakekey-t11" });
    const generateText = vi.fn<OpenAIClient["generateText"]>().mockResolvedValue({
      text: "model output that routes to fallback — only the call args matter",
      model: "gpt-5.5",
      retries: 0,
      status: 200,
    });
    const client: OpenAIClient = {
      hasApiKey: () => true,
      generateText,
      async generateImage() {
        return { skipped_no_api_key: true };
      },
    };

    await generateStarterArticle(env, {
      site_id: "site-t11",
      vertical: "personal finance",
      slug: "long-form-guide",
      title: "A long-form guide that needs more than 30 seconds to generate",
      client,
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    const opts = generateText.mock.calls[0]?.[0];
    if (!opts) throw new Error("expected generateText to be called with options");
    expect(typeof opts.timeoutMs).toBe("number");
    expect(opts.timeoutMs as number).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });
});
