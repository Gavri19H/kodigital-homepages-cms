import { describe, it, expect, vi, afterEach } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// T19 [E2]: real POST /api/admin/ai/image.
//
// The D1 layer is a mock that records every db.prepare(sql).bind(...) call,
// replays inserted ai_generations rows on the idempotency-key SELECT (so
// startGenerationLog's insert-then-reselect contract works), and answers the
// media INSERT ... RETURNING id with a fake row id. R2 is a put-recording
// stub. Outbound OpenAI traffic is a stubbed global fetch — no network
// leaves the test.

interface PreparedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run" | "all";
}

interface FakeAiRow {
  id: unknown;
  site_id: unknown;
  task: unknown;
  provider: unknown;
  model: unknown;
  prompt_version: unknown;
  idempotency_key: string;
  request_json: unknown;
  response_json: unknown;
  parsed_json: unknown;
  status: string;
  target_type: unknown;
  target_id: unknown;
  error_message: unknown;
  created_at: number;
  updated_at: number;
}

function makeFakeDb(opts: { mediaInsertReturnsRow?: boolean } = {}) {
  const mediaInsertReturnsRow = opts.mediaInsertReturnsRow ?? true;
  const calls: PreparedCall[] = [];
  const aiRows = new Map<string, FakeAiRow>();
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        calls.push({ sql, binds: captured, kind: "first" });
        if (sql.includes("FROM ai_generations")) {
          return (aiRows.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        if (sql.startsWith("INSERT INTO media")) {
          return (mediaInsertReturnsRow ? { id: 7 } : null) as T | null;
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, kind: "run" });
        if (sql.startsWith("INSERT INTO ai_generations")) {
          // INSERT_SQL bind order (generation-log.ts): id, site_id, task,
          // provider, model, prompt_version, idempotency_key, request_json,
          // target_type, target_id.
          const key = String(captured[6]);
          aiRows.set(key, {
            id: captured[0],
            site_id: captured[1],
            task: captured[2],
            provider: captured[3],
            model: captured[4],
            prompt_version: captured[5],
            idempotency_key: key,
            request_json: captured[7],
            response_json: null,
            parsed_json: null,
            status: "pending",
            target_type: captured[8],
            target_id: captured[9],
            error_message: null,
            created_at: 0,
            updated_at: 0,
          });
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'success'")) {
          const row = aiRows.get(String(captured[4]));
          if (row) {
            row.status = "success";
            row.response_json = captured[0];
            row.parsed_json = captured[1];
          }
        }
        if (sql.startsWith("UPDATE ai_generations SET status = 'failed'")) {
          const row = aiRows.get(String(captured[2]));
          if (row) {
            row.status = "failed";
            row.response_json = captured[0];
            row.error_message = captured[1];
          }
        }
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured, kind: "all" });
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, calls, aiRows };
}

interface RecordedPut {
  key: string;
  value: ArrayBuffer;
  options: { httpMetadata?: { contentType?: string } } | undefined;
}

function makeFakeMedia() {
  const puts: RecordedPut[] = [];
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      puts.push({ key, value, options });
      return null;
    },
  };
  return { media: bucket as unknown as R2Bucket, puts };
}

function buildEnv(
  db: D1Database,
  media: R2Bucket,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: media,
    APP_ENV: "development",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
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

function postImage(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const FAKE_PNG_B64 = Buffer.from("fake-png-bytes").toString("base64");

function stubOpenAIFetch(payload: unknown, status = 200): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/admin/ai/image (T19)", () => {
  it("returns 501 when OPENAI_API_KEY unset", async () => {
    const { db, calls } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "a lighthouse" }),
      buildEnv(db, media),
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY/);
    // No receipt row and no R2 put for the 501 path.
    expect(calls.filter((c) => c.sql.includes("ai_generations"))).toHaveLength(0);
    expect(puts).toHaveLength(0);
  });

  it("returns 400 when prompt is missing", async () => {
    const { db } = makeFakeDb();
    const { media } = makeFakeMedia();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({}),
      buildEnv(db, media, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 413 when the JSON body exceeds bodyLimit", async () => {
    const { db, calls } = makeFakeDb();
    const { media } = makeFakeMedia();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "x".repeat(70 * 1024) }),
      buildEnv(db, media, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(413);
    expect(calls.filter((c) => c.sql.includes("ai_generations"))).toHaveLength(0);
  });

  it("model=gpt-image-2: R2 put and media row insert via mock-D1 db.prepare", async () => {
    const { db, calls, aiRows } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    const fetchSpy = stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "a lighthouse at dusk", site_id: "site-1" }),
      buildEnv(db, media, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      model: string;
      media_id: number;
      storage_key: string;
      image_url: string;
      ai_generation_id: string;
    };
    expect(body.ok).toBe(true);
    expect(body.model).toBe("gpt-image-2");
    expect(body.media_id).toBe(7);
    expect(body.storage_key).toMatch(/^ai\/admin\/site-1\//);
    expect(body.image_url).toBe(`/media/${body.storage_key}`);
    expect(body.ai_generation_id).toBeTruthy();

    // The outbound call went to images/generations with model gpt-image-2.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/images/generations");
    const sent = JSON.parse(String(init.body)) as { model: string };
    expect(sent.model).toBe("gpt-image-2");

    // R2 put: decoded image bytes stored under the returned storage_key.
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toBe(body.storage_key);
    expect(puts[0]?.value.byteLength).toBeGreaterThan(0);
    expect(puts[0]?.options?.httpMetadata?.contentType).toBe("image/png");

    // media row INSERT through db.prepare with site_id + ai_generation_id.
    const mediaInsert = calls.find(
      (c) => c.kind === "first" && c.sql.startsWith("INSERT INTO media"),
    );
    expect(mediaInsert).toBeDefined();
    expect(mediaInsert!.binds[1]).toBe(body.storage_key);
    expect(mediaInsert!.binds[2]).toBe("image/png");
    expect(mediaInsert!.binds[5]).toBe("ai/admin");
    expect(mediaInsert!.binds[6]).toBe("site-1");
    expect(mediaInsert!.binds[7]).toBe(body.ai_generation_id);

    // ai_generations receipt row: INSERT with model=gpt-image-2 then the
    // success finisher UPDATE.
    const rows = [...aiRows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("success");
    expect(rows[0]?.model).toBe("gpt-image-2");
    expect(rows[0]?.task).toBe("admin-image");
    expect(rows[0]?.site_id).toBe("site-1");
  });

  it("returns 500 with failed receipt when media INSERT yields no row (no 2xx without DB row)", async () => {
    const { db, aiRows } = makeFakeDb({ mediaInsertReturnsRow: false });
    const { media, puts } = makeFakeMedia();
    stubOpenAIFetch({ data: [{ b64_json: FAKE_PNG_B64 }] });
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "a lighthouse" }),
      buildEnv(db, media, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(500);
    expect(puts).toHaveLength(1);
    const rows = [...aiRows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
  });

  it("writes failed receipt row and returns 502 when OpenAI errors", async () => {
    const { db, aiRows } = makeFakeDb();
    const { media, puts } = makeFakeMedia();
    // 400 is non-retriable so the client throws immediately (no retry sleep).
    stubOpenAIFetch({ error: { message: "bad request" } }, 400);
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "boom" }),
      buildEnv(db, media, { OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(502);
    expect(puts).toHaveLength(0);
    const rows = [...aiRows.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
  });

  it("is gated by accessAuth (401 without bypass)", async () => {
    const { db } = makeFakeDb();
    const { media } = makeFakeMedia();
    const res = await admin.request(
      "/api/admin/ai/image",
      postImage({ prompt: "hi" }),
      buildEnv(db, media, { DEV_BYPASS_AUTH: undefined, APP_ENV: "test" }),
    );
    expect(res.status).toBe(401);
  });
});
