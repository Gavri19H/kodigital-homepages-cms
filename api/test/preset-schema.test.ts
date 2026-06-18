import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import { renderPresets } from "../src/admin/templates/presets";
import type { Env } from "../src/env";

// T4 / Rescue 4: preset schema delta (migration 0019) + content_mapping
// image_prompts persistence. RC-009 backs T4-AC1.
//
// Part 1 asserts migration 0019 declares variables_schema + output_rules as
// TEXT DEFAULT '[]'. Like the 0010/0014 schema tests, this parses the
// migration SQL text — CI runs on Node 20 (package.json engines: node >=20)
// where node:sqlite's DatabaseSync (Node >= 22.5) is unavailable; the live-D1
// PRAGMA table_info(prompt_presets) proof runs through
// `wrangler d1 migrations apply --local` (the story db_check).
//
// Part 2 drives POST/PUT /api/admin/ai/presets through the admin router with a
// Map-backed fake D1 and asserts content_mapping round-trips
// image_prompts.{hero_image,above_subheadline_image} plus the new
// variables_schema/output_rules columns.
//
// Every it() title embeds the literal [api/test/preset-schema.test.ts] so the
// evidence runner's parse_test_output route observes a per-test name matching
// the RC-009 expected_test_name_regex.

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0019 = "0019_rescue4_preset_columns.sql";

function read0019(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_0019), "utf8");
}

describe("0019_rescue4_preset_columns.sql — T4 schema delta", () => {
  it("[api/test/preset-schema.test.ts] migration 0019 exists in the migrations directory", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0019);
  });

  it("[api/test/preset-schema.test.ts] declares variables_schema + output_rules as TEXT DEFAULT '[]' (AC1)", () => {
    const sql = read0019();
    for (const col of ["variables_schema", "output_rules"]) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+prompt_presets\\s+ADD\\s+COLUMN\\s+${col}\\s+TEXT\\s+DEFAULT\\s+'\\[\\]'`,
          "i",
        ),
      );
    }
  });

  it("[api/test/preset-schema.test.ts] contains no destructive ops (no DROP / table recreation)", () => {
    const sql = read0019();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});

// --- Part 2: content_mapping image_prompts + column round-trip via the router

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
  name: string | null;
  description: string | null;
  system_prompt_template: string | null;
  user_prompt_template: string | null;
  content_mapping: string | null;
  variables_schema: string | null;
  output_rules: string | null;
}

// Fake D1 covering exactly the SQL createPreset/updatePreset issue. The INSERT
// bind order (ai-presets-write.ts) ends ...content_mapping(12), then the
// migration-0019 columns variables_schema(13), output_rules(14).
function makeFakeDb() {
  const rows = new Map<number, PresetRow>();
  let nextId = 1;
  const prepare = (sql: string) => {
    let captured: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        captured = args;
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        if (sql.startsWith("SELECT * FROM prompt_presets WHERE id = ?")) {
          return (rows.get(Number(captured[0])) ?? null) as T | null;
        }
        if (sql.startsWith("SELECT id FROM prompt_presets WHERE slug = ?")) {
          const found = [...rows.values()].find((r) => r.slug === captured[0]);
          return (found ? { id: found.id } : null) as T | null;
        }
        return null;
      },
      async run() {
        let last_row_id = 0;
        if (sql.startsWith("INSERT INTO prompt_presets")) {
          const id = nextId++;
          rows.set(id, {
            id,
            slug: String(captured[0]),
            prompt_template: String(captured[1]),
            category: captured[2] as string | null,
            variables: captured[3] as string | null,
            is_system: Number(captured[6]),
            is_active: Number(captured[7]),
            usage_count: 0,
            text_model: captured[4] as string | null,
            image_model: captured[5] as string | null,
            name: captured[8] as string | null,
            description: captured[9] as string | null,
            system_prompt_template: captured[10] as string | null,
            user_prompt_template: captured[11] as string | null,
            content_mapping: captured[12] as string | null,
            variables_schema: captured[13] as string | null,
            output_rules: captured[14] as string | null,
          });
          last_row_id = id;
        }
        if (sql.includes("COALESCE")) {
          // ...content_mapping(11), variables_schema(12), output_rules(13), id(14)
          const row = rows.get(Number(captured[14]));
          if (row) {
            if (captured[11] != null) row.content_mapping = String(captured[11]);
            if (captured[12] != null) row.variables_schema = String(captured[12]);
            if (captured[13] != null) row.output_rules = String(captured[13]);
          }
        }
        return { success: true, meta: { last_row_id } };
      },
      async all<T = unknown>() {
        return { results: [...rows.values()] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  };
  return { db: { prepare } as unknown as D1Database, rows };
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
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
  } as Env;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const BASE = "/api/admin/ai/presets";
const IMAGE_PROMPTS = {
  hero_image: "A cinematic hero shot of the topic",
  above_subheadline_image: "A supporting image above the subheadline",
};

describe("content_mapping persists image_prompts (T4-AC1)", () => {
  it("[api/test/preset-schema.test.ts] create round-trips content_mapping.image_prompts.{hero_image,above_subheadline_image}", async () => {
    const { db } = makeFakeDb();
    const content_mapping = JSON.stringify({
      content: true,
      image_prompts: IMAGE_PROMPTS,
    });
    const res = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "image-preset",
        user_prompt_template: "Write about {{topic}}",
        category: "content",
        content_mapping,
      }),
      buildEnv(db),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: PresetRow };
    expect(body.item.content_mapping).not.toBeNull();
    const stored = JSON.parse(body.item.content_mapping as string) as {
      image_prompts?: Record<string, string>;
    };
    expect(stored.image_prompts).toBeDefined();
    expect(stored.image_prompts?.hero_image).toBe(IMAGE_PROMPTS.hero_image);
    expect(stored.image_prompts?.above_subheadline_image).toBe(
      IMAGE_PROMPTS.above_subheadline_image,
    );
  });

  it("[api/test/preset-schema.test.ts] create persists variables_schema + output_rules, defaulting to '[]' when absent", async () => {
    const { db } = makeFakeDb();
    // Explicit values round-trip verbatim.
    const withValues = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "schema-preset",
        user_prompt_template: "Write {{x}}",
        category: "content",
        variables_schema: '[{"name":"x","type":"string"}]',
        output_rules: '["no markdown"]',
      }),
      buildEnv(db),
    );
    expect(withValues.status).toBe(201);
    const v = (await withValues.json()) as { item: PresetRow };
    expect(v.item.variables_schema).toBe('[{"name":"x","type":"string"}]');
    expect(v.item.output_rules).toBe('["no markdown"]');

    // Absent → the column DEFAULT '[]' literal.
    const { db: db2 } = makeFakeDb();
    const noValues = await admin.request(
      BASE,
      jsonInit("POST", {
        slug: "bare-preset",
        user_prompt_template: "Write {{x}}",
        category: "content",
      }),
      buildEnv(db2),
    );
    expect(noValues.status).toBe(201);
    const n = (await noValues.json()) as { item: PresetRow };
    expect(n.item.variables_schema).toBe("[]");
    expect(n.item.output_rules).toBe("[]");
  });

  it("[api/test/preset-schema.test.ts] the preset form exposes hero_image + above_subheadline_image image options with prompt boxes", () => {
    const html = renderPresets(null);
    expect(html).toContain("Image options");
    expect(html).toContain('data-image="hero_image"');
    expect(html).toContain('data-image="above_subheadline_image"');
    expect(html).toContain('data-image-prompt="hero_image"');
    expect(html).toContain('data-image-prompt="above_subheadline_image"');
  });

  it("[api/test/preset-schema.test.ts] edit mode pre-fills + reveals stored image_prompts", () => {
    const html = renderPresets({
      id: 5,
      slug: "edit-img",
      prompt_template: "p",
      category: "content",
      variables: null,
      is_system: 0,
      is_active: 1,
      text_model: null,
      image_model: null,
      name: "Edit Img",
      description: null,
      system_prompt_template: null,
      user_prompt_template: "p",
      content_mapping: JSON.stringify({ image_prompts: IMAGE_PROMPTS }),
    });
    // Stored prompt text is rendered into the revealed (non-hidden) textarea.
    expect(html).toContain("A cinematic hero shot of the topic");
    expect(html).toMatch(/data-image="hero_image"[^>]*checked/);
  });
});
