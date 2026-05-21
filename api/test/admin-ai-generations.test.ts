import { describe, expect, it } from "vitest";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { AiGenerationRow } from "../src/ai/generation-log";

// T10: AI Generations admin surface — list page + detail JSON, host/auth
// gating, paged response shape.
//
// BEHAVIORAL contract covered here (mirrors prd.json T10):
//   1. GIVEN a GET /api/admin/ai-generations request on ADMIN_HOST WHEN
//      the handler runs THEN it returns { ai_generations: [...], paging }
//      with rows shaped { task, model, prompt_version, status, target_type,
//      created_at, error_message }.
//   2. GIVEN a GET /api/admin/ai-generations request from a non-admin
//      host (example.com) THEN it returns 404 (T28 hostname gate).
//   3. GIVEN a GET /api/admin/ai-generations request on ADMIN_HOST
//      without a CF Access JWT (and DEV_BYPASS_AUTH unset) THEN it
//      returns 401 (accessAuth gate; only honored when APP_ENV !=
//      'production' is irrelevant — bypass is OFF here).
//   4. GIVEN a GET /api/admin/ai-generations/:id request on ADMIN_HOST
//      WHEN the row exists THEN it returns { ai_generation: { ... } }
//      with the full row including the three JSON payloads and
//      idempotency_key.
//   5. GIVEN a GET /api/admin/ai-generations/:id request on ADMIN_HOST
//      WHEN the row does NOT exist THEN it returns 404.

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              const rows = Array.isArray(entry.row) ? (entry.row as T[]) : [];
              return { results: rows, success: true, meta: {} };
            }
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

const SAMPLE_ROWS: ReadonlyArray<Partial<AiGenerationRow>> = [
  {
    id: "aigen_001",
    task: "starter_article",
    model: "gpt-test-model",
    prompt_version: "starter_article@1.0.0",
    status: "success",
    target_type: "article",
    created_at: 1700000100,
    error_message: null,
  },
  {
    id: "aigen_002",
    task: "tagline",
    model: "gpt-test-model",
    prompt_version: "tagline@1.0.0",
    status: "fallback",
    target_type: "site",
    created_at: 1700000000,
    error_message: "openai 429",
  },
];

describe("T10 admin ai-generations list + detail", () => {
  it("GET /api/admin/ai-generations returns paged shape with required columns", async () => {
    const { db } = makeFakeDb([
      {
        match: "FROM ai_generations ORDER BY created_at DESC",
        row: SAMPLE_ROWS,
      },
      { match: "COUNT(*) AS n FROM ai_generations", row: { n: 2 } },
    ]);
    const res = await admin.request(
      "/api/admin/ai-generations?page=1&page_size=25",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ai_generations: Array<Record<string, unknown>>;
      paging: {
        page: number;
        page_size: number;
        total: number;
        has_next: boolean;
        has_prev: boolean;
      };
    };
    expect(Array.isArray(body.ai_generations)).toBe(true);
    expect(body.ai_generations.length).toBe(2);
    const first = body.ai_generations[0] as Record<string, unknown>;
    expect(first).toHaveProperty("task");
    expect(first).toHaveProperty("model");
    expect(first).toHaveProperty("prompt_version");
    expect(first).toHaveProperty("status");
    expect(first).toHaveProperty("target_type");
    expect(first).toHaveProperty("created_at");
    expect(first).toHaveProperty("error_message");
    expect(body.paging.page).toBe(1);
    expect(body.paging.page_size).toBe(25);
    expect(body.paging.total).toBe(2);
    expect(body.paging.has_next).toBe(false);
    expect(body.paging.has_prev).toBe(false);
  });

  it("GET /api/admin/ai-generations exposes has_next when total exceeds page_size", async () => {
    const { db } = makeFakeDb([
      {
        match: "FROM ai_generations ORDER BY created_at DESC",
        row: SAMPLE_ROWS,
      },
      { match: "COUNT(*) AS n FROM ai_generations", row: { n: 60 } },
    ]);
    const res = await admin.request(
      "/api/admin/ai-generations?page=1&page_size=25",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paging: { has_next: boolean; has_prev: boolean; total: number };
    };
    expect(body.paging.total).toBe(60);
    expect(body.paging.has_next).toBe(true);
    expect(body.paging.has_prev).toBe(false);
  });

  it("GET /api/admin/ai-generations/:id returns the full row when found", async () => {
    const detail: Partial<AiGenerationRow> = {
      id: "aigen_abc",
      site_id: "st_test",
      task: "tagline",
      provider: "openai",
      model: "gpt-test-model",
      prompt_version: "tagline@1.0.0",
      idempotency_key: "k:tagline:st_test:1",
      status: "success",
      target_type: "site_setting",
      target_id: "st_test/tagline",
      request_json: '{"prompt":"..."}',
      response_json: '{"text":"hello"}',
      parsed_json: '{"value":"hello"}',
      error_message: null,
      created_at: 1700000200,
      updated_at: 1700000201,
    };
    const { db } = makeFakeDb([
      { match: "FROM ai_generations WHERE id = ?", row: detail },
    ]);
    const res = await admin.request(
      "/api/admin/ai-generations/aigen_abc",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ai_generation: Record<string, unknown>;
    };
    expect(body.ai_generation.id).toBe("aigen_abc");
    expect(body.ai_generation.task).toBe("tagline");
    expect(body.ai_generation.prompt_version).toBe("tagline@1.0.0");
    expect(body.ai_generation.idempotency_key).toBe("k:tagline:st_test:1");
    expect(body.ai_generation.request_json).toBeTruthy();
    expect(body.ai_generation.response_json).toBeTruthy();
    expect(body.ai_generation.parsed_json).toBeTruthy();
  });

  it("GET /api/admin/ai-generations/:id returns 404 when the row is missing", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      "/api/admin/ai-generations/missing",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  it("off-ADMIN_HOST GET /api/admin/ai-generations returns 404 (hostname gate)", async () => {
    const { db } = makeFakeDb();
    // Hit the FULL app (not just the admin router) so the host gate in
    // index.ts is exercised. example.com != ADMIN_HOST.
    const res = await app.request(
      "https://example.com/api/admin/ai-generations",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
  });

  it("on-ADMIN_HOST GET /api/admin/ai-generations without a CF Access JWT returns 401 or 403", async () => {
    const { db } = makeFakeDb();
    const env = buildEnv(db, {
      DEV_BYPASS_AUTH: "false",
      CF_ACCESS_TEAM_DOMAIN: "kodigital.cloudflareaccess.com",
      CF_ACCESS_AUD: "test-aud",
    });
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/ai-generations",
      {},
      env,
    );
    expect([401, 403]).toContain(res.status);
  });

  it("GET /admin/ai-generations (HTML shell) renders the list table with ai_generation_id column", async () => {
    const { db } = makeFakeDb([
      {
        match: "FROM ai_generations ORDER BY created_at DESC",
        row: SAMPLE_ROWS,
      },
      { match: "COUNT(*) AS n FROM ai_generations", row: { n: 2 } },
    ]);
    const res = await admin.request("/admin/ai-generations", {}, buildEnv(db));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("ai-generations-list");
    expect(html).toContain("ai_generation_id");
    expect(html).toContain("aigen_001");
  });
});
