import { afterEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  applyPreset,
  PRESET_CATEGORIES,
  type PresetCategory,
} from "../src/ai/generators/preset-engine";
import { resolveCategoryPreset } from "../src/ai/generators/preset-resolver";
import { generateStarterArticle } from "../src/ai/generators/text";
import type { OpenAIClient } from "../src/ai/openai-client";

// T9 [BCL-041] — the single preset-application engine drives generation in both
// the editor /chat path and the provisioning text path.
// RC-019 (T9-AC1) and RC-020 (T9-AC2) route through parse_test_output against
// THIS file, so every it() title embeds the literal
// [api/test/preset-engine.test.ts] and carries the L2 observation pattern.
//
// AC1: a full preset applies ALL seven configurable categories (system + user
// prompt, model, content-mapping JSON-schema, output-rules, variables, image
// options) — not the legacy 2 (combined prompt + model). The four structured
// categories the legacy resolver dropped are proven both present in
// appliedCategories AND folded into the prompt the model receives.
// AC2: editing a preset prompt changes the generated output for an editor
// /chat call (the real endpoint, OUTBOUND request inspected) AND a provisioning
// text call (the real generateStarterArticle dispatch + the resolver).

// ---------------------------------------------------------------------------
// Shared preset fixtures.
// ---------------------------------------------------------------------------
const FULL_PRESET = {
  id: 71,
  slug: "full-preset",
  category: "content",
  is_system: 1,
  is_active: 1,
  usage_count: 0,
  prompt_template: "flat fallback",
  system_prompt_template: "You are the founding editor for {{brand}}.",
  user_prompt_template: "Write a piece about {{topic}}.",
  text_model: "gpt-5.5",
  image_model: "gpt-image-2",
  variables_schema: JSON.stringify([
    { key: "brand", description: "Brand name", default: "DefaultBrand", required: true },
  ]),
  output_rules: JSON.stringify([
    {
      paragraph_type: "body",
      min: 3,
      max: 8,
      style: "journalistic",
      json_schema: '{"type":"object"}',
    },
  ]),
  content_mapping: JSON.stringify({
    title: true,
    excerpt: true,
    enforce_json_schema: true,
    paragraph_count: 5,
    image_prompts: { hero_image: "A bright on-brand hero shot" },
  }),
};

const MINIMAL_PRESET = {
  id: 72,
  slug: "minimal-preset",
  category: "content",
  is_system: 1,
  is_active: 1,
  usage_count: 0,
  prompt_template: "flat",
  system_prompt_template: "You are an editor.",
  user_prompt_template: "Write something.",
  text_model: "gpt-5.5",
  image_model: null,
  // The structured categories are empty (the migration-0019 defaults): the
  // legacy resolver applied exactly these and nothing more.
  variables_schema: "[]",
  output_rules: "[]",
  content_mapping: null,
};

// The four categories the legacy provisioning resolver silently dropped.
const STRUCTURED: PresetCategory[] = [
  "content_mapping",
  "output_rules",
  "variables",
  "image_options",
];

// ---------------------------------------------------------------------------
// T9-AC1 (RC-019): the engine applies all seven categories, not two.
// ---------------------------------------------------------------------------
describe("T9-AC1: single engine applies all seven preset categories", () => {
  it("[api/test/preset-engine.test.ts] T9-AC1: a full preset applies all seven categories and folds each into the prompt L2_AUTO_DISAMBIGUATION:T9-AC1:RC-019", () => {
    const applied = applyPreset({ preset: FULL_PRESET, variables: { topic: "budgets" } });

    // All seven configurable categories contributed — not the legacy 2.
    expect(applied.appliedCategories).toHaveLength(7);
    expect(new Set(applied.appliedCategories)).toEqual(new Set(PRESET_CATEGORIES));
    // The four categories the legacy resolver dropped are now all applied.
    for (const cat of STRUCTURED) {
      expect(applied.appliedCategories).toContain(cat);
    }

    // Each category is genuinely folded into the effective prompt the model
    // receives (presence in the list is backed by an effect on the prompt).
    const p = applied.effectivePrompt;
    expect(p).toContain("You are the founding editor for DefaultBrand."); // system + variables default
    expect(p).toContain("Write a piece about budgets."); // user prompt + caller var
    expect(p).toContain("paragraph type body, min 3, max 8, style journalistic"); // output rules
    expect(p).toContain("Populate these content fields: title, excerpt."); // content mapping
    expect(p).toContain("Write 5 paragraphs."); // content mapping paragraph_count
    expect(p).toContain("strict JSON"); // JSON-schema enforcement
    expect(p).toContain("hero_image: A bright on-brand hero shot"); // image options
    // model resolves to the preset's supported text_model.
    expect(applied.model).toBe("gpt-5.5");
    // variables_schema default fills the unsupplied {{brand}}.
    expect(applied.variables.brand).toBe("DefaultBrand");
  });

  it("[api/test/preset-engine.test.ts] T9-AC1: a prompt-only preset applies NONE of the four structured categories (the legacy 2-category gap) L2_AUTO_DISAMBIGUATION:T9-AC1:RC-019", () => {
    const applied = applyPreset({ preset: MINIMAL_PRESET, variables: {} });

    // Only system + user + model — the structured four are absent, exactly the
    // legacy behaviour this story replaces.
    expect(applied.appliedCategories).toEqual(["system_prompt", "user_prompt", "model"]);
    for (const cat of STRUCTURED) {
      expect(applied.appliedCategories).not.toContain(cat);
    }
    // No directive block is folded in, so the effective prompt is the plain
    // system+user join (backward compatible with the legacy combined prompt).
    expect(applied.directives).toBe("");
    expect(applied.effectivePrompt).toBe("You are an editor.\n\nWrite something.");
  });
});

// ---------------------------------------------------------------------------
// T9-AC2 (RC-020) — editor /chat. Drive the REAL endpoint with a stubbed fetch
// and a mock D1; inspect the OUTBOUND OpenAI request. Editing the preset's
// prompt changes the system message on the wire.
// ---------------------------------------------------------------------------
interface FakeAiRow {
  idempotency_key: string;
  status: string;
}

function makeChatDb(presetRow: Record<string, unknown> | null) {
  const aiRows = new Map<string, FakeAiRow>();
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.includes("FROM prompt_presets")) return presetRow as T | null;
        if (sql.includes("FROM ai_generations")) {
          return (aiRows.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO ai_generations")) {
          const key = String(captured[6]);
          aiRows.set(key, { idempotency_key: key, status: "pending" });
        }
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function buildEnv(db: D1Database): Env {
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
  } as Env;
}

function stubOpenAIFetch(): ReturnType<typeof vi.fn> {
  const impl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", impl);
  return impl;
}

function sentSystemMessage(spy: ReturnType<typeof vi.fn>): string {
  const call = spy.mock.calls[spy.mock.calls.length - 1] as [string, RequestInit];
  const body = JSON.parse(String(call[1].body)) as {
    messages: Array<{ role: string; content: string }>;
  };
  const system = body.messages.find((m) => m.role === "system");
  return system?.content ?? "";
}

function chatPresetWithSystem(template: string): Record<string, unknown> {
  return {
    id: 90,
    slug: "voice",
    category: "content",
    is_system: 1,
    is_active: 1,
    usage_count: 0,
    prompt_template: "flat",
    system_prompt_template: template,
    user_prompt_template: null,
    text_model: null,
    image_model: null,
    variables_schema: "[]",
    output_rules: "[]",
    content_mapping: null,
  };
}

async function chatSystemFor(template: string): Promise<string> {
  const db = makeChatDb(chatPresetWithSystem(template));
  const spy = stubOpenAIFetch();
  const res = await admin.request(
    "/api/admin/ai/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "the operator question",
        presetId: 90,
        variables: { brand: "Acme" },
      }),
    },
    buildEnv(db),
  );
  expect(res.status).toBe(200);
  const system = sentSystemMessage(spy);
  vi.unstubAllGlobals();
  return system;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("T9-AC2 (editor): editing a preset prompt changes the /chat output", () => {
  it("[api/test/preset-engine.test.ts] T9-AC2: editing system_prompt_template changes the OUTBOUND system message of the real /chat endpoint L2_AUTO_DISAMBIGUATION:T9-AC2:RC-020", async () => {
    const alpha = await chatSystemFor("Voice ALPHA for {{brand}}.");
    const beta = await chatSystemFor("Voice BETA for {{brand}}.");

    // Interpolated through the single engine and overrides the operator tone.
    expect(alpha).toBe("Voice ALPHA for Acme.");
    expect(beta).toBe("Voice BETA for Acme.");
    // The edit changed what reaches the model.
    expect(alpha).not.toBe(beta);
  });
});

// ---------------------------------------------------------------------------
// T9-AC2 (RC-020) — provisioning. Drive the REAL generateStarterArticle with a
// capturing client (no network) and a mock D1 that returns the 'content'
// preset; editing the preset's prompt changes the prompt dispatched to the
// model. The resolver (the provisioning preset-application entry) is asserted
// directly too.
// ---------------------------------------------------------------------------
function makeProvisioningDb(presetRow: Record<string, unknown> | null) {
  const aiRows = new Map<string, Record<string, unknown>>();
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.includes("FROM prompt_presets")) return presetRow as T | null;
        if (sql.includes("FROM ai_generations")) {
          return (aiRows.get(String(captured[0] ?? "")) ?? null) as T | null;
        }
        return null;
      },
      async run() {
        if (sql.startsWith("INSERT INTO ai_generations")) {
          const id = String(captured[0]);
          const key = String(captured[6]);
          if (!aiRows.has(key)) {
            aiRows.set(key, {
              id,
              idempotency_key: key,
              task: String(captured[2]),
              model: String(captured[4]),
              prompt_version: String(captured[5]),
              status: "pending",
              response_json: null,
              parsed_json: null,
              error_message: null,
            });
          }
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'success'")) {
          const row = aiRows.get(String(captured[4]));
          if (row) {
            row.status = "success";
            row.response_json = captured[0];
            row.parsed_json = captured[1];
          }
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'fallback'")) {
          const row = aiRows.get(String(captured[4]));
          if (row) {
            row.status = "fallback";
            row.parsed_json = captured[0];
          }
        } else if (sql.startsWith("UPDATE ai_generations SET status = 'failed'")) {
          const row = aiRows.get(String(captured[2]));
          if (row) row.status = "failed";
        }
        return { success: true };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true };
      },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

function capturingClient(prompts: string[]): OpenAIClient {
  return {
    hasApiKey: () => true,
    async generateText(opts) {
      prompts.push(opts.prompt);
      return { text: "{}", model: "gpt-5.5", retries: 0, status: 200 };
    },
    async generateImage() {
      return { skipped_no_api_key: true };
    },
  };
}

function contentPresetWithUser(template: string): Record<string, unknown> {
  return {
    id: 95,
    slug: "content-voice",
    category: "content",
    is_system: 1,
    is_active: 1,
    usage_count: 0,
    prompt_template: "FLAT-FALLBACK",
    system_prompt_template: "You are the editor for {{brand_name}}.",
    user_prompt_template: template,
    text_model: "gpt-5.5",
    image_model: null,
    variables_schema: "[]",
    output_rules: "[]",
    content_mapping: null,
  };
}

async function provisioningPromptFor(userTemplate: string): Promise<string> {
  const env = buildEnv(makeProvisioningDb(contentPresetWithUser(userTemplate)));
  const prompts: string[] = [];
  await generateStarterArticle(env, {
    site_id: "st_t9",
    vertical: "personal finance",
    brand_name: "Acme Daily",
    slug: "budgeting-basics",
    title: "Budgeting Basics",
    summary: "How to build a first budget.",
    client: capturingClient(prompts),
  });
  expect(prompts).toHaveLength(1);
  return prompts[0] ?? "";
}

describe("T9-AC2 (provisioning): editing a preset prompt changes the provisioning text call", () => {
  it("[api/test/preset-engine.test.ts] T9-AC2: editing the preset prompt changes the prompt generateStarterArticle dispatches to the model L2_AUTO_DISAMBIGUATION:T9-AC2:RC-020", async () => {
    const alpha = await provisioningPromptFor("Compose {{title}} in mode ALPHA.");
    const beta = await provisioningPromptFor("Compose {{title}} in mode BETA.");

    expect(alpha).toContain("Compose Budgeting Basics in mode ALPHA.");
    expect(beta).toContain("Compose Budgeting Basics in mode BETA.");
    // The provisioning dispatch is NOT the deterministic builder — it is the
    // preset-driven prompt, and the edit changed it.
    expect(alpha).not.toBe(beta);
    expect(alpha).not.toContain("Output strict JSON matching GeneratedArticle shape");
  });

  it("[api/test/preset-engine.test.ts] T9-AC2: the provisioning resolver (same engine) reflects the preset edit and applies the structured categories L2_AUTO_DISAMBIGUATION:T9-AC2:RC-020", async () => {
    // A full content preset → the resolver's effective prompt carries the
    // structured directives (output rules + content mapping), proving the
    // provisioning path applies all categories via the single engine.
    const env = buildEnv(makeProvisioningDb(FULL_PRESET));
    const resolved = await resolveCategoryPreset(env, "content", {
      topic: "budgets",
      brand_name: "Acme Daily",
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.prompt).toContain("paragraph type body, min 3, max 8");
    expect(resolved?.prompt).toContain("Populate these content fields: title, excerpt.");
    expect(resolved?.model).toBe("gpt-5.5");

    // Editing the user prompt changes the resolver output (same engine, same
    // control surface as the editor path).
    const a = await resolveCategoryPreset(
      buildEnv(makeProvisioningDb(contentPresetWithUser("Draft {{title}} ALPHA"))),
      "content",
      { title: "X" },
    );
    const b = await resolveCategoryPreset(
      buildEnv(makeProvisioningDb(contentPresetWithUser("Draft {{title}} BETA"))),
      "content",
      { title: "X" },
    );
    expect(a?.prompt).not.toBe(b?.prompt);
    expect(a?.prompt).toContain("Draft X ALPHA");
    expect(b?.prompt).toContain("Draft X BETA");
  });
});
