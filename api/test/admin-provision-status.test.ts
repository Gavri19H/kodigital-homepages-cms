import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// WARN-FIX-1: GET /api/admin/sites/:id/provision returns the latest
// site_creation_job_steps row as {resource:{current_step, status,
// step_key}}. Missing site OR missing job both return 404 with a
// neutral error message — the handler MUST NOT leak whether the site
// exists when there is no provisioning job for it.

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
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
          void captured;
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
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

describe("GET /api/admin/sites/:id/provision (WARN-FIX-1)", () => {
  it("returns 200 + {resource:{current_step,status,step_key}} from the latest step row", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_one" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_one",
          site_id: "st_one",
          status: "running",
          current_step_index: 5,
          total_steps: 15,
        },
      },
      {
        match: "FROM site_creation_job_steps",
        row: {
          step_key: "create_site_settings",
          step_order: 5,
          status: "completed",
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_one/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { current_step: number; status: string; step_key: string };
    };
    expect(body.resource.current_step).toBe(5);
    expect(body.resource.status).toBe("completed");
    expect(body.resource.step_key).toBe("create_site_settings");
  });

  it("falls back to the job row when no step rows exist yet (pending job)", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_two" } },
      {
        match: "FROM site_creation_jobs WHERE site_id = ?",
        row: {
          id: "job_two",
          site_id: "st_two",
          status: "pending",
          current_step_index: 0,
          total_steps: 15,
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_two/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      resource: { current_step: number; status: string; step_key: string };
    };
    expect(body.resource.current_step).toBe(0);
    expect(body.resource.status).toBe("pending");
    expect(body.resource.step_key).toBe("");
  });

  it("returns 404 when no site_creation_jobs row exists for the site_id", async () => {
    const db = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "st_three" } },
      // No site_creation_jobs row planted -> findActiveJobForSite returns null.
    ]);
    const res = await admin.request(
      "/api/admin/sites/st_three/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("returns 404 when the site itself does not exist (no internal-state leak)", async () => {
    const db = makeFakeDb();
    const res = await admin.request(
      "/api/admin/sites/st_missing/provision",
      {},
      buildEnv(db),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});
