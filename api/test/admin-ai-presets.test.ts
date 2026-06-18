import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// T21 [E4]: presets CRUD + model constraint + migration 0011.
//
// Part 1 asserts migration 0011 declares the text_model/image_model
// columns on prompt_presets. Runtime applicability of the full 0001..0011
// chain (including this file) is exercised by
// migrations-0010-content-mode.test.ts, which applies every migration in
// filename order to an in-memory SQLite database; the live-D1 PRAGMA proof
// runs through `wrangler d1 migrations apply --local`.
//
// Part 2 drives the 6 /api/admin/ai/presets* routes through the admin
// router with a fake D1 that replays prompt_presets rows from a Map, and
// asserts POST/PUT reject models outside the SUPPORTED registry lists with
// 400 — the legacy default model ids must be REJECTED, never silently
// "corrected" to a supported one.

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0011 = "0011_phase9_prompt_presets_model_columns.sql";

describe("migration 0011 — prompt_presets model columns (T21.AC4)", () => {
  it("declares both model columns as nullable TEXT ALTERs", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_0011), "utf8");
    expect(sql).toMatch(/ALTER TABLE prompt_presets ADD COLUMN text_model TEXT/);
    expect(sql).toMatch(/ALTER TABLE prompt_presets ADD COLUMN image_model TEXT/);
    // No model id literal is baked into the schema (registry owns defaults).
    expect(sql).not.toMatch(/DEFAULT\s+'gpt/i);
  });
});

interface PresetRow {
  id: number;
  slug: string;
  prompt_template: string;
  category: string | null;
  variables: string | null;
  is_system: number;
  is_active: number;
  usage_count: number;
  text_model: string | null;
  image_model: string | null;
  // T12 reference columns (migration 0014).
  name: string | null;
  description: string | null;
  system_prompt_template: string | null;
  user_prompt_template: string | null;
  content_mapping: string | null;
  // T4 reference columns (migration 0019).
  variables_schema: string | null;
  output_rules: string | null;
}

interface PreparedCall {
  sql: string;
  binds: unknown[];
  kind: "first" | "run" | "all";
}

// Fake D1 for the handlers' exact SQL: a Map-backed prompt_presets store.
function makeFakeDb() {
  const calls: PreparedCall[] = [];
  const rows = new Map<number, PresetRow>();
  let nextId = 1;
  const seed = (row: Partial<PresetRow>): PresetRow => {
    const id = nextId++;
    const full: PresetRow = {
      id,
      slug: row.slug ?? `preset-${id}`,
      prompt_template: row.prompt_template ?? "Write about {{topic}}",
      category: row.category ?? null,
      variables: row.variables ?? null,
      is_system: row.is_system ?? 0,
      is_active: row.is_active ?? 1,
      usage_count: row.usage_count ?? 0,
      text_model: row.text_model ?? null,
      image_model: row.image_model ?? null,
      name: row.name ?? null,
      description: row.description ?? null,
      system_prompt_template: row.system_prompt_template ?? null,
      user_prompt_template: row.user_prompt_template ?? null,
      content_mapping: row.content_mapping ?? null,
      variables_schema: row.variables_schema ?? "[]",
      output_rules: row.output_rules ?? "[]",
    };
    rows.set(id, full);
    return full;
  };
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        calls.push({ sql, binds: captured, kind: "first" });
        if (sql.startsWith("SELECT COUNT(*)")) {
          return { count: rows.size } as T;
        }
        if (sql.startsWith("SELECT * FROM prompt_presets WHERE id = ?")) {
          return (rows.get(Number(captured[0])) ?? null) as T | null;
        }
        if (
          sql.startsWith("SELECT id FROM prompt_presets WHERE slug = ? AND id != ?")
        ) {
          const found = [...rows.values()].find(
            (r) => r.slug === captured[0] && r.id !== Number(captured[1]),
          );
          return (found ? { id: found.id } : null) as T | null;
        }
        if (sql.startsWith("SELECT id FROM prompt_presets WHERE slug = ?")) {
          const found = [...rows.values()].find((r) => r.slug === captured[0]);
          return (found ? { id: found.id } : null) as T | null;
        }
        return null;
      },
      async run() {
        calls.push({ sql, binds: captured, kind: "run" });
        let last_row_id = 0;
        if (sql.startsWith("INSERT INTO prompt_presets")) {
          // Bind order (ai-presets-write.ts): slug, prompt_template,
          // category, variables, text_model, image_model, is_system,
          // is_active, name, description, system_prompt_template,
          // user_prompt_template, content_mapping, variables_schema,
          // output_rules.
          const created = seed({
            slug: String(captured[0]),
            prompt_template: String(captured[1]),
            category: captured[2] as string | null,
            variables: captured[3] as string | null,
            text_model: captured[4] as string | null,
            image_model: captured[5] as string | null,
            is_system: Number(captured[6]),
            is_active: Number(captured[7]),
            name: captured[8] as string | null,
            description: captured[9] as string | null,
            system_prompt_template: captured[10] as string | null,
            user_prompt_template: captured[11] as string | null,
            content_mapping: captured[12] as string | null,
            variables_schema: captured[13] as string | null,
            output_rules: captured[14] as string | null,
          });
          last_row_id = created.id;
        }
        if (sql.includes("SET usage_count = usage_count + 1")) {
          const row = rows.get(Number(captured[0]));
          if (row) row.usage_count += 1;
        }
        if (sql.startsWith("UPDATE prompt_presets SET is_active = ?")) {
          const row = rows.get(Number(captured[1]));
          if (row) row.is_active = Number(captured[0]);
        }
        if (sql.includes("COALESCE")) {
          // Bind order: slug, prompt_template, category, variables,
          // text_model, image_model, is_active, name, description,
          // system_prompt_template, user_prompt_template, content_mapping,
          // variables_schema, output_rules, id.
          const row = rows.get(Number(captured[14]));
          if (row) {
            if (captured[0] != null) row.slug = String(captured[0]);
            if (captured[1] != null) row.prompt_template = String(captured[1]);
            if (captured[2] != null) row.category = String(captured[2]);
            if (captured[3] != null) row.variables = String(captured[3]);
            if (captured[4] != null) row.text_model = String(captured[4]);
            if (captured[5] != null) row.image_model = String(captured[5]);
            if (captured[6] != null) row.is_active = Number(captured[6]);
            if (captured[7] != null) row.name = String(captured[7]);
            if (captured[8] != null) row.description = String(captured[8]);
            if (captured[9] != null) {
              row.system_prompt_template = String(captured[9]);
            }
            if (captured[10] != null) {
              row.user_prompt_template = String(captured[10]);
            }
            if (captured[11] != null) row.content_mapping = String(captured[11]);
            if (captured[12] != null) row.variables_schema = String(captured[12]);
            if (captured[13] != null) row.output_rules = String(captured[13]);
          }
        }
        if (sql.startsWith("DELETE FROM prompt_presets")) {
          rows.delete(Number(captured[0]));
        }
        return { success: true, meta: { last_row_id } };
      },
      async all<T = unknown>() {
        calls.push({ sql, binds: captured, kind: "all" });
        return { results: [...rows.values()] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, calls, rows, seed };
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
    ...overrides,
  };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const BASE = "/api/admin/ai/presets";

describe("presets route patterns are mounted (T21.AC1)", () => {
  it("all 6 routes answer with handler JSON, not the router 404", async () => {
    const { db, seed } = makeFakeDb();
    seed({ slug: "tagline" });
    const env = buildEnv(db);

    const list = await admin.request(BASE, { method: "GET" }, env);
    expect(list.status).toBe(200);

    const create = await admin.request(
      BASE,
      jsonInit("POST", { slug: "fresh", prompt_template: "Do {{x}}" }),
      env,
    );
    expect(create.status).toBe(201);

    const get = await admin.request(`${BASE}/1`, { method: "GET" }, env);
    expect(get.status).toBe(200);

    const put = await admin.request(
      `${BASE}/1`,
      jsonInit("PUT", { category: "general" }),
      env,
    );
    expect(put.status).toBe(200);

    const use = await admin.request(`${BASE}/1/use`, { method: "POST" }, env);
    expect(use.status).toBe(200);

    const del = await admin.request(`${BASE}/1`, { method: "DELETE" }, env);
    expect(del.status).toBe(204);
  });

  it("list returns items + pagination (legacy shape)", async () => {
    const { db, seed } = makeFakeDb();
    seed({ slug: "one" });
    seed({ slug: "two" });
    const res = await admin.request(BASE, { method: "GET" }, buildEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: PresetRow[];
      pagination: { page: number; total: number };
    };
    expect(body.items).toHaveLength(2);
    expect(body.pagination.total).toBe(2);
    expect(body.pagination.page).toBe(1);
  });
});

describe("POST /api/admin/ai/presets (T21.AC2 create)", () => {
  it("rejects a text_model outside SUPPORTED_TEXT_MODELS with 400", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "bad-text",
        prompt_template: "x",
        text_model: "gpt-4o-mini",
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unsupported text_model/);
    expect(calls.filter((c) => c.sql.startsWith("INSERT"))).toHaveLength(0);
  });

  it("rejects an image_model outside SUPPORTED_IMAGE_MODELS with 400", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "bad-image",
        prompt_template: "x",
        image_model: "gpt-image-1",
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unsupported image_model/);
    expect(calls.filter((c) => c.sql.startsWith("INSERT"))).toHaveLength(0);
  });

  it("accepts supported models and stores them verbatim", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "explicit",
        prompt_template: "x",
        text_model: "gpt-5.5",
        image_model: "gpt-image-2",
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: PresetRow };
    expect(body.item.text_model).toBe("gpt-5.5");
    expect(body.item.image_model).toBe("gpt-image-2");
  });

  it("defaults missing models to the registry defaults", async () => {
    const { db } = makeFakeDb();
    const res = await admin.request(
      BASE,
      jsonInit("POST", { slug: "defaults", prompt_template: "x" }),
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: PresetRow };
    expect(body.item.text_model).toBe("gpt-5.5");
    expect(body.item.image_model).toBe("gpt-image-2");
  });

  it("400s on missing slug/prompt_template and 409s on duplicate slug", async () => {
    const { db, seed } = makeFakeDb();
    seed({ slug: "taken" });
    const env = buildEnv(db);
    const noSlug = await admin.request(
      BASE,
      jsonInit("POST", { prompt_template: "x" }),
      env,
    );
    expect(noSlug.status).toBe(400);
    const noTemplate = await admin.request(
      BASE,
      jsonInit("POST", { slug: "s" }),
      env,
    );
    expect(noTemplate.status).toBe(400);
    const dup = await admin.request(
      BASE,
      jsonInit("POST", { slug: "taken", prompt_template: "x" }),
      env,
    );
    expect(dup.status).toBe(409);
  });
});

describe("T12 reference columns round-trip (wire consistency)", () => {
  it("create persists name/description/system+user prompts/content_mapping and derives prompt_template from the User Prompt", async () => {
    const { db } = makeFakeDb();
    // The reference form posts the User Prompt (no flat prompt_template).
    const res = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "ref-preset",
        name: "Reference Preset",
        description: "A reference-shaped preset",
        category: "content",
        system_prompt_template: "You are an editor.",
        user_prompt_template: "Write about {{topic}}",
        variables: '["topic"]',
        content_mapping: '{"content":true,"title":true}',
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: PresetRow };
    expect(body.item.name).toBe("Reference Preset");
    expect(body.item.description).toBe("A reference-shaped preset");
    expect(body.item.system_prompt_template).toBe("You are an editor.");
    expect(body.item.user_prompt_template).toBe("Write about {{topic}}");
    expect(body.item.content_mapping).toBe('{"content":true,"title":true}');
    // prompt_template stays NOT NULL — derived from the User Prompt.
    expect(body.item.prompt_template).toBe("Write about {{topic}}");
  });

  it("create 400s when neither prompt_template nor user_prompt_template is sent", async () => {
    const { db, calls } = makeFakeDb();
    const res = await admin.request(
      BASE,
      jsonInit("POST", { slug: "no-prompt", name: "No Prompt" }),
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    expect(calls.filter((c) => c.sql.startsWith("INSERT"))).toHaveLength(0);
  });

  it("update persists the reference columns", async () => {
    const { db, seed } = makeFakeDb();
    const row = seed({ slug: "edit-ref", category: "content" });
    const res = await admin.request(
      `${BASE}/${row.id}`,
      jsonInit("PUT", {
        description: "updated desc",
        system_prompt_template: "New system prompt",
        content_mapping: '{"seo":true}',
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: PresetRow };
    expect(body.item.description).toBe("updated desc");
    expect(body.item.system_prompt_template).toBe("New system prompt");
    expect(body.item.content_mapping).toBe('{"seo":true}');
  });
});

describe("PUT /api/admin/ai/presets/:id (T21.AC2 update)", () => {
  it("rejects a text_model outside SUPPORTED_TEXT_MODELS with 400", async () => {
    const { db, seed, rows } = makeFakeDb();
    const row = seed({ slug: "edit-me", text_model: "gpt-5.5" });
    const res = await admin.request(
      `${BASE}/${row.id}`,
      jsonInit("PUT", { text_model: "gpt-4o-mini" }),
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unsupported text_model/);
    // Never silently corrected: the stored model is untouched.
    expect(rows.get(row.id)?.text_model).toBe("gpt-5.5");
  });

  it("rejects an image_model outside SUPPORTED_IMAGE_MODELS with 400", async () => {
    const { db, seed, rows } = makeFakeDb();
    const row = seed({ slug: "edit-me-2", image_model: "gpt-image-2" });
    const res = await admin.request(
      `${BASE}/${row.id}`,
      jsonInit("PUT", { image_model: "gpt-image-1" }),
      buildEnv(db),
    );
    expect(res.status).toBe(400);
    expect(rows.get(row.id)?.image_model).toBe("gpt-image-2");
  });

  it("updates supported model + fields and returns the row", async () => {
    const { db, seed } = makeFakeDb();
    const row = seed({ slug: "update-ok" });
    const res = await admin.request(
      `${BASE}/${row.id}`,
      jsonInit("PUT", { text_model: "gpt-5.5", category: "seo" }),
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: PresetRow };
    expect(body.item.text_model).toBe("gpt-5.5");
    expect(body.item.category).toBe("seo");
  });

  it("404s on unknown id and 400s on a non-numeric id", async () => {
    const { db } = makeFakeDb();
    const env = buildEnv(db);
    const missing = await admin.request(
      `${BASE}/99`,
      jsonInit("PUT", { category: "x" }),
      env,
    );
    expect(missing.status).toBe(404);
    const invalid = await admin.request(
      `${BASE}/abc`,
      jsonInit("PUT", { category: "x" }),
      env,
    );
    expect(invalid.status).toBe(400);
  });

  it("system presets: is_active toggles, other edits 403", async () => {
    const { db, seed, rows } = makeFakeDb();
    const row = seed({ slug: "system", is_system: 1 });
    const env = buildEnv(db);
    const toggle = await admin.request(
      `${BASE}/${row.id}`,
      jsonInit("PUT", { is_active: 0 }),
      env,
    );
    expect(toggle.status).toBe(200);
    expect(rows.get(row.id)?.is_active).toBe(0);
    const edit = await admin.request(
      `${BASE}/${row.id}`,
      jsonInit("PUT", { slug: "renamed" }),
      env,
    );
    expect(edit.status).toBe(403);
  });
});

describe("GET/DELETE/use routes (T21.AC1 behavior)", () => {
  it("GET :id returns the row; unknown 404; bad id 400", async () => {
    const { db, seed } = makeFakeDb();
    const row = seed({ slug: "read-me" });
    const env = buildEnv(db);
    const ok = await admin.request(`${BASE}/${row.id}`, { method: "GET" }, env);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { item: PresetRow };
    expect(body.item.slug).toBe("read-me");
    const missing = await admin.request(`${BASE}/99`, { method: "GET" }, env);
    expect(missing.status).toBe(404);
    const invalid = await admin.request(`${BASE}/abc`, { method: "GET" }, env);
    expect(invalid.status).toBe(400);
  });

  it("DELETE removes the row; system presets 403", async () => {
    const { db, seed, rows } = makeFakeDb();
    const normal = seed({ slug: "doomed" });
    const system = seed({ slug: "protected", is_system: 1 });
    const env = buildEnv(db);
    const del = await admin.request(
      `${BASE}/${normal.id}`,
      { method: "DELETE" },
      env,
    );
    expect(del.status).toBe(204);
    expect(rows.has(normal.id)).toBe(false);
    const denied = await admin.request(
      `${BASE}/${system.id}`,
      { method: "DELETE" },
      env,
    );
    expect(denied.status).toBe(403);
    expect(rows.has(system.id)).toBe(true);
  });

  it("POST :id/use increments usage_count", async () => {
    const { db, seed, rows } = makeFakeDb();
    const row = seed({ slug: "counted", usage_count: 2 });
    const res = await admin.request(
      `${BASE}/${row.id}/use`,
      { method: "POST" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(rows.get(row.id)?.usage_count).toBe(3);
  });
});
