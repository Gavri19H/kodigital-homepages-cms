// T12 Presets pages: GET /admin/presets/new + GET /admin/presets/:id render
// the reference preset form (renderPresets) inside the adminLayout shell.
// The reference form (MISSION W4) carries Name* (auto-derives slug) +
// Description, a REQUIRED name="category" use-case <select> (NOT a text
// input), split System/User prompt textareas, {{variable}} click-to-insert
// chips (NO raw name="variables" field), a "Content Preset Mapping" content-map,
// and model selects sourced ONLY from the SUPPORTED_*_MODELS registry. New
// mode targets POST /api/admin/ai/presets; edit mode targets PUT
// /api/admin/ai/presets/:id.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import {
  presetFormPage,
  presetsListPage,
  renderPresets,
} from "../src/admin/templates/presets";
import {
  SUPPORTED_IMAGE_MODELS,
  SUPPORTED_TEXT_MODELS,
} from "../src/ai/models";
import type { Env } from "../src/env";

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): D1Database {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
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
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  } as Env;
}

const EXISTING_PRESET = {
  id: 7,
  slug: "article-intro",
  prompt_template: "Write an intro about {{topic}}",
  category: "content",
  variables: '["topic"]',
  is_system: 0,
  is_active: 1,
  usage_count: 0,
  text_model: "gpt-5.5",
  image_model: "gpt-image-2",
  name: "Article Intro",
  description: "Intro generator for articles",
  system_prompt_template: "You are a concise editorial writer.",
  user_prompt_template: "Write an intro about {{topic}}",
  content_mapping: '{"content":true}',
};

describe("T12 renderPresets reference form (AC1/AC3)", () => {
  it("emits Name, Description, a REQUIRED name=category SELECT, System+User prompts, chips + content-map", () => {
    const html = renderPresets(null);
    // Name* + Description
    expect(html).toMatch(/<input[^>]*id="preset-name"[^>]*name="name"[^>]*required/);
    expect(html).toContain('name="description"');
    // REQUIRED use-case category SELECT — NOT a text input, NOT name="variables"
    expect(html).toMatch(/<select[^>]*name="category"[^>]*required/);
    expect(html).not.toMatch(/name="category"[^>]*type="text"/);
    expect(html).not.toContain('name="variables"');
    for (const opt of ["title", "excerpt", "outline", "content", "seo", "image", "custom"]) {
      expect(html).toContain(`<option value="${opt}"`);
    }
    // System + User prompt split
    expect(html).toContain('name="system_prompt_template"');
    expect(html).toContain('name="user_prompt_template"');
    // {{variable}} chips + auto-detect target
    expect(html).toContain('class="var-chip"');
    expect(html).toContain("{{topic}}");
    expect(html).toContain('id="preset-detected-vars"');
    // Content Preset Mapping content map (T8 renamed the section to the
    // reference label; the cmap-field / data-field contract is unchanged).
    expect(html).toContain("Content Preset Mapping");
    expect(html).toContain('class="cmap-field"');
    expect(html).toContain('data-field="content"');
  });

  it("does NOT regress to the old freeform Category text input or raw Variables textarea", () => {
    const html = renderPresets(null);
    expect(html).not.toContain('id="preset-variables"');
    expect(html).not.toMatch(/<input[^>]*name="category"/);
  });
});

describe("T12 admin presets pages", () => {
  it("GET /admin/presets/new renders the create form targeting POST /api/admin/ai/presets", async () => {
    const res = await admin.request(
      "/admin/presets/new",
      {},
      buildEnv(makeFakeDb()),
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-marker="kodigital-admin-shell"');
    expect(html).toContain('id="preset-form"');
    expect(html).toContain('data-preset-id=""');
    expect(html).toContain('"/api/admin/ai/presets"');
    // Reference fields are wired into the live template the route emits.
    expect(html).toMatch(/<select[^>]*name="category"[^>]*required/);
    expect(html).toContain('name="system_prompt_template"');
    expect(html).toContain('name="user_prompt_template"');
    expect(html).toContain('class="var-chip"');
    // Model options come ONLY from the SUPPORTED registry lists.
    for (const m of SUPPORTED_TEXT_MODELS) {
      expect(html).toContain(`<option value="${m}" selected>${m}</option>`);
    }
    for (const m of SUPPORTED_IMAGE_MODELS) {
      expect(html).toContain(`<option value="${m}" selected>${m}</option>`);
    }
  });

  it("GET /admin/presets/:id loads the prompt_presets row into the edit form (PUT target)", async () => {
    const db = makeFakeDb([
      { match: "FROM prompt_presets WHERE id = ?", row: EXISTING_PRESET },
    ]);
    const res = await admin.request("/admin/presets/7", {}, buildEnv(db));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-preset-id="7"');
    expect(html).toContain('value="Article Intro"');
    expect(html).toContain('value="article-intro"');
    // The use-case category pre-selects the stored enum value.
    expect(html).toContain('<option value="content" selected>Content</option>');
    // System + User prompts pre-fill from their own columns.
    expect(html).toContain("You are a concise editorial writer.");
    expect(html).toContain("Write an intro about {{topic}}");
    // The stored content_mapping pre-checks its fields.
    expect(html).toMatch(/data-field="content"[^>]*checked/);
    // Edit mode reaches the PUT path via the shared base URL + id concat.
    expect(html).toContain('"/api/admin/ai/presets/"+encodeURIComponent(presetId)');
    expect(html).toContain('id="preset-delete"');
  });

  it("system presets render with everything but the Active toggle disabled", () => {
    const html = presetFormPage({
      ...EXISTING_PRESET,
      is_system: 1,
    });
    expect(html).toContain("System preset");
    expect(html).toMatch(/id="preset-name"[^>]*disabled/);
    expect(html).toMatch(/id="preset-slug"[^>]*disabled/);
    expect(html).not.toContain('id="preset-delete"');
    expect(html).toMatch(/id="preset-is-active"[^>]*checked/);
  });

  it("the presets list links to /admin/presets/new and to each preset editor", () => {
    const html = presetsListPage([
      { id: "7", label: "article-intro", model: "", scope: "user" },
    ]);
    expect(html).toContain('href="/admin/presets/new"');
    expect(html).toContain('href="/admin/presets/7"');
  });
});
