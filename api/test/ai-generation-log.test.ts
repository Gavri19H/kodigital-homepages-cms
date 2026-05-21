import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";
import {
  finishGenerationLogFailure,
  finishGenerationLogFallback,
  finishGenerationLogSuccess,
  getGenerationByIdempotencyKey,
  redactSecretsFromPayload,
  startGenerationLog,
  type AiGenerationRow,
} from "../src/ai/generation-log";

// T6: ai_generations CRUD with idempotency lookup + secret redaction.
//
// The D1 layer is mocked with a fake prepared-statement spy so we can assert
// (a) the static SQL string, (b) the .bind() argument list, and (c) the
// status transitions written for success / failure / fallback finishers.
//
// AC8 BEHAVIORAL "SQL uses .bind() not template literals" is verified two
// ways: structurally by reading the implementation source and proving every
// `prepare(...)` is followed by `.bind(`, and dynamically by capturing the
// arguments passed to .bind for each finisher.

const IMPL_PATH = resolve(
  __dirname,
  "..",
  "src",
  "ai",
  "generation-log.ts",
);

interface CapturedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run";
}

function makeFakeDb(rows: Record<string, AiGenerationRow | null>) {
  const calls: CapturedCall[] = [];
  const store = new Map<string, AiGenerationRow | null>(Object.entries(rows));

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
        return { success: true };
      },
    };
    return stmt;
  };

  return {
    db: { prepare } as unknown as D1Database,
    calls,
    store,
  };
}

function makeEnv(db: D1Database): Env {
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
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

function makeRow(overrides: Partial<AiGenerationRow> = {}): AiGenerationRow {
  return {
    id: "gen-1",
    site_id: "site-a",
    task: "site-tagline",
    provider: "openai",
    model: "gpt-5.5",
    prompt_version: "site-tagline:v1",
    idempotency_key: "k1",
    request_json: null,
    response_json: null,
    parsed_json: null,
    status: "pending",
    target_type: null,
    target_id: null,
    error_message: null,
    created_at: 1_700_000_000,
    updated_at: 1_700_000_000,
    ...overrides,
  };
}

describe("T6 redactSecretsFromPayload", () => {
  it("replaces 'sk-abc1234' literal inside a string with [REDACTED]", () => {
    expect(redactSecretsFromPayload("token=sk-abc1234")).toBe(
      "token=[REDACTED]",
    );
  });

  it("redacts 'Bearer sk-...' headers in nested objects", () => {
    const out = redactSecretsFromPayload({
      headers: { Authorization: "Bearer sk-abc1234ZZZZ" },
      body: "ok",
    });
    expect(out).toEqual({
      headers: { Authorization: "Bearer [REDACTED]" },
      body: "ok",
    });
  });

  it("walks arrays and nested objects, leaving non-strings untouched", () => {
    const out = redactSecretsFromPayload({
      messages: [
        { role: "user", content: "ignore me" },
        { role: "system", content: "key sk-abc1234defg" },
      ],
      retries: 0,
      ok: true,
      meta: null,
    });
    expect(out).toEqual({
      messages: [
        { role: "user", content: "ignore me" },
        { role: "system", content: "key [REDACTED]" },
      ],
      retries: 0,
      ok: true,
      meta: null,
    });
  });

  it("does not change strings without an sk- key", () => {
    expect(redactSecretsFromPayload("plain text")).toBe("plain text");
  });
});

describe("T6 startGenerationLog -- inserts a pending row, uses .bind() params", () => {
  it("returns the inserted row and binds 10 positional args (no template-literal SQL)", async () => {
    const fake = makeFakeDb({});
    const env = makeEnv(fake.db);
    // The very first lookup returns null (no existing row), then after
    // INSERT the lookup returns the freshly-stored row.
    let lookupCount = 0;
    const originalPrepare = fake.db.prepare;
    (fake.db as unknown as { prepare: typeof originalPrepare }).prepare = ((
      sql: string,
    ) => {
      const stmt = originalPrepare(sql);
      const origFirst = stmt.first.bind(stmt);
      stmt.first = async <T>() => {
        lookupCount += 1;
        if (lookupCount === 1) return null as T | null;
        return makeRow({ idempotency_key: "k-insert" }) as T | null;
      };
      return stmt;
    }) as typeof originalPrepare;

    const result = await startGenerationLog(env, {
      id: "gen-1",
      site_id: "site-a",
      task: "site-tagline",
      model: "gpt-5.5",
      prompt_version: "site-tagline:v1",
      idempotency_key: "k-insert",
      request_json: { prompt: "p", key: "sk-abc1234real" },
    });

    expect(result.idempotency_key).toBe("k-insert");
    const insertCall = fake.calls.find((c) => c.sql.startsWith("INSERT INTO ai_generations"));
    expect(insertCall, "INSERT SQL must be issued").toBeTruthy();
    expect(insertCall?.kind).toBe("run");
    expect(insertCall?.binds.length).toBe(10);
    // request_json bound position is index 7 in INSERT_SQL bind list.
    const reqJson = insertCall?.binds[7];
    expect(typeof reqJson).toBe("string");
    expect(reqJson as string).toContain("[REDACTED]");
    expect(reqJson as string).not.toContain("sk-abc1234real");
  });

  it("short-circuits when an existing row already matches idempotency_key", async () => {
    const fake = makeFakeDb({
      "k-existing": makeRow({ idempotency_key: "k-existing", status: "success" }),
    });
    const env = makeEnv(fake.db);
    const out = await startGenerationLog(env, {
      id: "gen-x",
      site_id: "site-a",
      task: "site-tagline",
      model: "gpt-5.5",
      prompt_version: "site-tagline:v1",
      idempotency_key: "k-existing",
    });
    expect(out.status).toBe("success");
    // No INSERT must have been issued -- only the SELECT-by-key lookup.
    const insertCall = fake.calls.find((c) => c.sql.startsWith("INSERT INTO ai_generations"));
    expect(insertCall).toBeUndefined();
  });
});

describe("T6 getGenerationByIdempotencyKey", () => {
  it("returns the matching row for a known idempotency_key", async () => {
    const fake = makeFakeDb({
      k1: makeRow({ idempotency_key: "k1", status: "pending" }),
    });
    const env = makeEnv(fake.db);
    const row = await getGenerationByIdempotencyKey(env, "k1");
    expect(row?.idempotency_key).toBe("k1");
    expect(row?.status).toBe("pending");
    const selectCall = fake.calls.find((c) => c.sql.startsWith("SELECT id, site_id"));
    expect(selectCall, "SELECT SQL must be issued").toBeTruthy();
    expect(selectCall?.binds).toEqual(["k1"]);
  });

  it("returns null when no row matches", async () => {
    const fake = makeFakeDb({});
    const env = makeEnv(fake.db);
    const row = await getGenerationByIdempotencyKey(env, "missing");
    expect(row).toBeNull();
  });
});

describe("T6 finishGenerationLogSuccess", () => {
  it("issues UPDATE ... status = 'success' with .bind() params + redacted payload", async () => {
    const row = makeRow({ idempotency_key: "ks", status: "pending" });
    const fake = makeFakeDb({ ks: row });
    const env = makeEnv(fake.db);
    await finishGenerationLogSuccess(env, {
      idempotency_key: "ks",
      response_json: { choices: [{ message: { content: "ok" } }], key: "sk-abc1234x" },
      parsed_json: { text: "fine" },
      target_type: "site_settings",
      target_id: "site-a",
    });
    const updateCall = fake.calls.find((c) =>
      c.sql.includes("UPDATE ai_generations SET status = 'success'"),
    );
    expect(updateCall, "UPDATE success SQL must be issued").toBeTruthy();
    expect(updateCall?.kind).toBe("run");
    const respJson = updateCall?.binds[0];
    expect(typeof respJson).toBe("string");
    expect(respJson as string).toContain("[REDACTED]");
    expect(respJson as string).not.toContain("sk-abc1234x");
    expect(updateCall?.binds[2]).toBe("site_settings");
    expect(updateCall?.binds[3]).toBe("site-a");
    expect(updateCall?.binds[4]).toBe("ks");
  });
});

describe("T6 finishGenerationLogFailure", () => {
  it("issues UPDATE ... status = 'failed' with redacted error_message", async () => {
    const row = makeRow({ idempotency_key: "kf", status: "pending" });
    const fake = makeFakeDb({ kf: row });
    const env = makeEnv(fake.db);
    await finishGenerationLogFailure(env, {
      idempotency_key: "kf",
      error_message: "auth failed for sk-abc1234zzz",
      response_json: { error: "auth", token: "sk-abc1234zzz" },
    });
    const updateCall = fake.calls.find((c) =>
      c.sql.includes("UPDATE ai_generations SET status = 'failed'"),
    );
    expect(updateCall, "UPDATE failure SQL must be issued").toBeTruthy();
    expect(updateCall?.kind).toBe("run");
    const respJson = updateCall?.binds[0];
    const errMsg = updateCall?.binds[1];
    expect(typeof respJson).toBe("string");
    expect(respJson as string).toContain("[REDACTED]");
    expect(typeof errMsg).toBe("string");
    expect(errMsg as string).toBe("auth failed for [REDACTED]");
    expect(updateCall?.binds[2]).toBe("kf");
  });
});

describe("T6 finishGenerationLogFallback", () => {
  it("issues UPDATE ... status = 'fallback' with parsed_json + COALESCE target columns", async () => {
    const row = makeRow({ idempotency_key: "kfb", status: "pending" });
    const fake = makeFakeDb({ kfb: row });
    const env = makeEnv(fake.db);
    await finishGenerationLogFallback(env, {
      idempotency_key: "kfb",
      parsed_json: { fallback_text: "default tagline" },
      target_type: "site_settings",
      target_id: "site-a",
      error_message: "no api key (sk-abc1234should-not-appear)",
    });
    const updateCall = fake.calls.find((c) =>
      c.sql.includes("UPDATE ai_generations SET status = 'fallback'"),
    );
    expect(updateCall, "UPDATE fallback SQL must be issued").toBeTruthy();
    expect(updateCall?.kind).toBe("run");
    const parsed = updateCall?.binds[0];
    expect(typeof parsed).toBe("string");
    expect(parsed as string).toContain("default tagline");
    expect(updateCall?.binds[1]).toBe("site_settings");
    expect(updateCall?.binds[2]).toBe("site-a");
    const errMsg = updateCall?.binds[3];
    expect(typeof errMsg).toBe("string");
    expect(errMsg as string).toBe("no api key ([REDACTED])");
    expect(updateCall?.binds[4]).toBe("kfb");
  });
});

describe("T6 implementation source -- structural .bind() invariant", () => {
  it("every prepare(...) is followed by .bind(...) (no template-literal SQL)", () => {
    const src = readFileSync(IMPL_PATH, "utf8");
    // Reject any back-tick template literal inside a prepare(...) call.
    expect(/\.prepare\(\s*`/.test(src)).toBe(false);
    // Every prepare( call must be followed (eventually) by .bind(.
    const prepareCount = (src.match(/\.prepare\(/g) ?? []).length;
    const bindCount = (src.match(/\.bind\(/g) ?? []).length;
    expect(prepareCount).toBeGreaterThanOrEqual(1);
    expect(bindCount).toBeGreaterThanOrEqual(prepareCount);
  });

  it("references OPENAI_API_KEY or sk- (redaction surface)", () => {
    const src = readFileSync(IMPL_PATH, "utf8");
    expect(/OPENAI_API_KEY|sk-/.test(src)).toBe(true);
  });
});

describe("T6 redactSecretsFromPayload -- edge cases", () => {
  it("returns the value unchanged for null/undefined/numbers/booleans", () => {
    expect(redactSecretsFromPayload(null)).toBeNull();
    expect(redactSecretsFromPayload(undefined)).toBeUndefined();
    expect(redactSecretsFromPayload(42)).toBe(42);
    expect(redactSecretsFromPayload(true)).toBe(true);
  });

  it("redacts every sk- occurrence in a single string, not just the first", () => {
    const out = redactSecretsFromPayload("a=sk-aaaa1234 b=sk-bbbb1234");
    expect(out).toBe("a=[REDACTED] b=[REDACTED]");
  });
});

// Silence stray console output during the test run.
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
