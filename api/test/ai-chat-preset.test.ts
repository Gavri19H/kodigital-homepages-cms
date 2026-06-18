import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  applyChatPreset,
  LENGTH_WORD_BUDGETS,
  lengthToMaxTokens,
} from "../src/admin/ai-chat-preset";
import {
  renderAIAssistantPanel,
  aiAssistantScripts,
} from "../src/admin/templates/ai-panel";

// T7 [BCL-032] — structured, preset-driven POST /api/admin/ai/chat.
// RC-015 (T7-AC1) and RC-016 (T7-AC2) route through parse_test_output against
// THIS file, so every it() title embeds the literal
// [api/test/ai-chat-preset.test.ts] (satisfies both the api/test/… and test/…
// expected_test_name_regex forms) and carries the L2 observation pattern.
//
// AC1 is proven behaviorally: the real endpoint is driven through
// admin.request with a stubbed global fetch + a mock D1, and the OUTBOUND
// OpenAI request body is inspected — the preset system_prompt_template becomes
// the system message and OVERRIDES the tone, options.length maps to max_tokens.
// AC2 asserts the rendered panel sends presetId+options and shows a
// system-prompt preview that updates on preset select.

interface PreparedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run" | "all";
}

interface FakeAiRow {
  idempotency_key: string;
  status: string;
  response_json: unknown;
  parsed_json: unknown;
  error_message: unknown;
}

function makeFakeDb(presetRow: Record<string, unknown> | null) {
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
        if (sql.includes("FROM prompt_presets")) {
          return presetRow as T | null;
        }
        if (sql.includes("FROM ai_generations")) {
          const row = aiRows.get(String(captured[0] ?? ""));
          return (row ?? null) as T | null;
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, kind: "run" });
        if (sql.startsWith("INSERT INTO ai_generations")) {
          const key = String(captured[6]);
          aiRows.set(key, {
            idempotency_key: key,
            status: "pending",
            response_json: null,
            parsed_json: null,
            error_message: null,
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
  return { db: { prepare } as unknown as D1Database, calls };
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
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
    OPENAI_API_KEY: "sk-test",
    ...overrides,
  };
}

function postChat(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function stubOpenAIFetch(content = "model output"): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

interface SentChat {
  model: string;
  messages: Array<{ role: string; content: string }>;
  max_completion_tokens?: number;
}

function lastSentBody(spy: ReturnType<typeof vi.fn>): SentChat {
  const call = spy.mock.calls[spy.mock.calls.length - 1] as [string, RequestInit];
  return JSON.parse(String(call[1].body)) as SentChat;
}

const PRESET = {
  id: 7,
  slug: "witty-copy",
  prompt_template: "Write copy",
  category: "content",
  variables: null,
  is_system: 1,
  is_active: 1,
  usage_count: 0,
  text_model: null,
  image_model: null,
  name: "Witty Copy",
  description: null,
  system_prompt_template: "You are a witty copywriter for {{brand}}.",
  user_prompt_template: "Write a tagline for {{brand}}.",
  content_mapping: null,
  variables_schema: "[]",
  output_rules: "[]",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// T7-AC1 (RC-015): server applies the preset system prompt + overrides tone;
// length -> max_tokens; no preset -> per-action default.
// ---------------------------------------------------------------------------
describe("T7-AC1: preset-driven /chat applies system prompt + tone override + length budget", () => {
  it("[api/test/ai-chat-preset.test.ts] T7-AC1: a selected preset's system_prompt_template becomes the system message and OVERRIDES the requested tone L2_AUTO_DISAMBIGUATION:T7-AC1:RC-015", async () => {
    const { db } = makeFakeDb(PRESET);
    const fetchSpy = stubOpenAIFetch();
    const res = await admin.request(
      "/api/admin/ai/chat",
      postChat({
        prompt: "Write a tagline",
        presetId: 7,
        options: { tone: "formal", length: "short" },
        variables: { brand: "Acme" },
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    const sent = lastSentBody(fetchSpy);
    const [system, user] = sent.messages;
    // The preset system_prompt_template (interpolated) is the system message.
    expect(system).toEqual({
      role: "system",
      content: "You are a witty copywriter for Acme.",
    });
    expect(user).toEqual({
      role: "user",
      content: "Write a tagline",
    });
    // OVERRIDES tone: the requested options.tone never reaches the model — the
    // preset's voice is authoritative.
    expect(system?.content ?? "").not.toContain("formal");
  });

  it("[api/test/ai-chat-preset.test.ts] T7-AC1: length short/medium/long map to ~400/800/1500-word max_tokens budgets on the wire L2_AUTO_DISAMBIGUATION:T7-AC1:RC-015", async () => {
    const cases: Array<[string, number]> = [
      ["short", 534],
      ["medium", 1067],
      ["long", 2000],
    ];
    for (const [length, expected] of cases) {
      const { db } = makeFakeDb(null);
      const fetchSpy = stubOpenAIFetch();
      const res = await admin.request(
        "/api/admin/ai/chat",
        postChat({ prompt: "hi", options: { length } }),
        buildEnv(db),
      );
      expect(res.status).toBe(200);
      expect(lastSentBody(fetchSpy).max_completion_tokens).toBe(expected);
      vi.unstubAllGlobals();
    }
  });

  it("[api/test/ai-chat-preset.test.ts] T7-AC1: no preset -> per-action default system prompt carries the requested tone, medium budget L2_AUTO_DISAMBIGUATION:T7-AC1:RC-015", async () => {
    const { db } = makeFakeDb(null);
    const fetchSpy = stubOpenAIFetch();
    const res = await admin.request(
      "/api/admin/ai/chat",
      postChat({ prompt: "hi", options: { tone: "friendly" } }),
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const sent = lastSentBody(fetchSpy);
    const [system] = sent.messages;
    expect(system?.role).toBe("system");
    expect(system?.content ?? "").toContain("friendly");
    // No length given -> medium default budget.
    expect(sent.max_completion_tokens).toBe(1067);
  });

  it("[api/test/ai-chat-preset.test.ts] T7-AC1: a presetId that resolves to no row is a 404 (panel sent a preset that no longer exists) L2_AUTO_DISAMBIGUATION:T7-AC1:RC-015", async () => {
    const { db } = makeFakeDb(null);
    stubOpenAIFetch();
    const res = await admin.request(
      "/api/admin/ai/chat",
      postChat({ prompt: "hi", presetId: 999 }),
      buildEnv(db),
    );
    expect(res.status).toBe(404);
  });

  it("[api/test/ai-chat-preset.test.ts] T7-AC1: the pure length->max_tokens engine matches the ~400/800/1500-word contract L2_AUTO_DISAMBIGUATION:T7-AC1:RC-015", () => {
    expect(LENGTH_WORD_BUDGETS).toEqual({ short: 400, medium: 800, long: 1500 });
    expect(lengthToMaxTokens("short")).toBe(534);
    expect(lengthToMaxTokens("medium")).toBe(1067);
    expect(lengthToMaxTokens("long")).toBe(2000);
    // Unknown / absent length falls back to the medium budget.
    expect(lengthToMaxTokens(undefined)).toBe(1067);
    expect(lengthToMaxTokens("xl")).toBe(1067);

    // The engine drops options.tone when a preset is applied (tone override),
    // and keeps it as the default system prompt otherwise.
    const withPreset = applyChatPreset({
      preset: PRESET as never,
      options: { tone: "formal", length: "long" },
      variables: { brand: "Acme" },
    });
    expect(withPreset.presetApplied).toBe(true);
    expect(withPreset.toneApplied).toBeNull();
    expect(withPreset.systemPrompt).toBe("You are a witty copywriter for Acme.");
    expect(withPreset.maxTokens).toBe(2000);

    const noPreset = applyChatPreset({
      preset: null,
      options: { tone: "friendly" },
    });
    expect(noPreset.presetApplied).toBe(false);
    expect(noPreset.toneApplied).toBe("friendly");
    expect(noPreset.systemPrompt).toContain("friendly");
  });
});

// ---------------------------------------------------------------------------
// T7-AC2 (RC-016): the panel sends presetId+options and shows a system-prompt
// preview that updates on preset select.
// ---------------------------------------------------------------------------
describe("T7-AC2: the AI panel sends presetId+options and previews the system prompt", () => {
  const html = renderAIAssistantPanel();
  const scripts = aiAssistantScripts;

  it("[api/test/ai-chat-preset.test.ts] T7-AC2: the panel renders a dedicated system-prompt preview surface L2_AUTO_DISAMBIGUATION:T7-AC2:RC-016", () => {
    expect(html).toContain('id="ai-system-preview"');
    expect(html).toContain(">System prompt<");
  });

  it("[api/test/ai-chat-preset.test.ts] T7-AC2: the system-prompt preview is rendered from system_prompt_template and updates on preset select L2_AUTO_DISAMBIGUATION:T7-AC2:RC-016", () => {
    expect(scripts).toContain("renderSystemPreview");
    expect(scripts).toContain("system_prompt_template");
    // renderPreview (fired by the preset change listener + every variable edit)
    // drives the system preview, so it updates on preset select.
    expect(scripts).toContain("renderSystemPreview()");
    expect(scripts).toContain("presetSelect.addEventListener('change'");
  });

  it("[api/test/ai-chat-preset.test.ts] T7-AC2: the request payload carries presetId + options + variables L2_AUTO_DISAMBIGUATION:T7-AC2:RC-016", () => {
    expect(scripts).toContain("payload.options");
    expect(scripts).toContain("tone: toneEl");
    expect(scripts).toContain("length: lengthEl");
    expect(scripts).toContain("payload.presetId");
    expect(scripts).toContain("payload.variables");
  });
});
