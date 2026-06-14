// T33 [B12] Presets pages: GET /admin/presets/new + GET /admin/presets/:id
// render the presetFormPage editor inside the adminLayout shell, with model
// selects sourced ONLY from the SUPPORTED_*_MODELS registry (the same lists
// the write handlers validate against). New mode targets POST
// /api/admin/ai/presets; edit mode targets PUT /api/admin/ai/presets/:id.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import {
  presetFormPage,
  presetsListPage,
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
  category: "articles",
  variables: '["topic"]',
  is_system: 0,
  is_active: 1,
  usage_count: 0,
  text_model: "gpt-5.5",
  image_model: "gpt-image-2",
};

describe("T33 admin presets pages", () => {
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
    expect(html).toContain('value="article-intro"');
    expect(html).toContain("Write an intro about {{topic}}");
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
