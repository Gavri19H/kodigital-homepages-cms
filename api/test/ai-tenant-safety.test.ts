import { describe, expect, it } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";
import type { OpenAIClient } from "../src/ai/openai-client";
import type { AiGenerationRow } from "../src/ai/generation-log";
import { generateStarterArticle } from "../src/ai/generators/text";
import { TenantBoundaryViolation } from "../src/site/tenant-guards";

// T11: AI calls require site_id (except global presets); public routes
// cannot trigger AI; tenant-bound generation.
//
// BEHAVIORAL contract covered here (mirrors prd.json T11):
//   1. GIVEN generateStarterArticle is called with site_id='site-a' WHEN
//      the model returns a JSON body whose site_id is 'site-b' THEN the
//      tenant guard throws TenantBoundaryViolation (NOT silently
//      rewritten to fallback).
//   2. GIVEN a POST /api/admin/ai/generate-text request from a non-admin
//      host (example.com) THEN it returns 404 (hostname gate in
//      api/src/index.ts).
//   3. GIVEN a POST /api/admin/ai/generate-text request on ADMIN_HOST
//      without a CF Access JWT THEN it returns 401 or 403 (accessAuth
//      gate; DEV_BYPASS_AUTH=false in production-like env).
//   4. GIVEN generateStarterArticle is called with site_id missing or
//      empty THEN requireSiteIdForArticleInput throws (no implicit site
//      selection — tenant-bound generation is mandatory).

interface CapturedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run";
}

function makeFakeDb() {
  const calls: CapturedCall[] = [];
  const store = new Map<string, AiGenerationRow>();
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
        return (store.get(key) ?? null) as T | null;
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
        }
        return { success: true };
      },
    };
    return stmt;
  };
  return { prepare, calls, store };
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  const db = makeFakeDb();
  return {
    DB: { prepare: db.prepare } as unknown as D1Database,
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
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function makeEnv(overrides: Partial<Env> = {}): {
  env: Env;
  store: Map<string, AiGenerationRow>;
} {
  const db = makeFakeDb();
  const env = {
    DB: { prepare: db.prepare } as unknown as D1Database,
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
    OPENAI_API_KEY: "sk-test",
    ...overrides,
  } as Env;
  return { env, store: db.store };
}

function clientReturningArticleJson(body: string): OpenAIClient {
  return {
    hasApiKey: () => true,
    async generateText() {
      return {
        text: body,
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

describe("T11 tenant boundary in generateStarterArticle", () => {
  it("throws TenantBoundaryViolation when the model returns a different site_id than the caller", async () => {
    const { env } = makeEnv();
    const body = JSON.stringify({
      site_id: "site-b",
      slug: "different-tenant",
      title: "Cross-tenant article",
      intro: "intro",
      sections: [],
      faqs: [],
    });
    await expect(
      generateStarterArticle(env, {
        site_id: "site-a",
        vertical: "personal finance",
        slug: "different-tenant",
        title: "Cross-tenant article",
        client: clientReturningArticleJson(body),
      }),
    ).rejects.toBeInstanceOf(TenantBoundaryViolation);
  });

  it("requires site_id on the input (no implicit site selection)", async () => {
    const { env } = makeEnv();
    await expect(
      generateStarterArticle(env, {
        // site_id deliberately empty — requireSiteIdForArticleInput must throw.
        site_id: "",
        vertical: "personal finance",
        slug: "missing-site",
        title: "Should be refused",
        client: clientReturningArticleJson("{}"),
      }),
    ).rejects.toThrow(/site_id/);
  });

  it("accepts the call when the model echoes the caller's site_id", async () => {
    const { env } = makeEnv();
    const body = JSON.stringify({
      site_id: "site-a",
      slug: "same-tenant",
      title: "Same-tenant article",
      intro: "intro",
      sections: [
        {
          heading: { level: 2, text: "Section 1" },
          paragraphs: ["a", "b"],
        },
        {
          heading: { level: 2, text: "Section 2" },
          paragraphs: ["a", "b"],
        },
        {
          heading: { level: 2, text: "Section 3" },
          paragraphs: ["a", "b"],
        },
      ],
      faqs: [
        { question: "q1", answer: "a1" },
        { question: "q2", answer: "a2" },
        { question: "q3", answer: "a3" },
      ],
    });
    const result = await generateStarterArticle(env, {
      site_id: "site-a",
      vertical: "personal finance",
      slug: "same-tenant",
      title: "Same-tenant article",
      client: clientReturningArticleJson(body),
    });
    expect(result.parsed.site_id).toBe("site-a");
  });
});

describe("T11 host + JWT gating on /api/admin/ai/generate-text", () => {
  it("off-ADMIN_HOST POST /api/admin/ai/generate-text returns 404 (hostname gate)", async () => {
    const env = buildEnv({ OPENAI_API_KEY: "sk-test" });
    const res = await app.request(
      "https://example.com/api/admin/ai/generate-text",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("on-ADMIN_HOST POST /api/admin/ai/generate-text without a CF Access JWT returns 401 or 403", async () => {
    const env = buildEnv({
      OPENAI_API_KEY: "sk-test",
      DEV_BYPASS_AUTH: "false",
      CF_ACCESS_TEAM_DOMAIN: "kodigital.cloudflareaccess.com",
      CF_ACCESS_AUD: "test-aud",
    });
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/ai/generate-text",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      },
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it("off-ADMIN_HOST POST /api/admin/ai/image returns 404 (hostname gate)", async () => {
    const env = buildEnv({ OPENAI_API_KEY: "sk-test" });
    const res = await app.request(
      "https://example.com/api/admin/ai/image",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello" }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("T11 no public AI route", () => {
  it("public host GET /api/public/ai/generate-text returns 404 (no public AI surface exists)", async () => {
    const env = buildEnv({ OPENAI_API_KEY: "sk-test" });
    const res = await app.request(
      "https://example.com/api/public/ai/generate-text",
      { method: "GET" },
      env,
    );
    expect(res.status).toBe(404);
  });
});
